import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {db,snapshot,type AppDB} from './db';
import {validatePlan,validateClients,type Plan,type Client,type Photo} from './model';
const MAX=256*1024*1024;
interface PhotoMeta extends Omit<Photo,'blob'> {path:string;size:number;sha256:string}
interface Manifest {format:'otgruzki-backup';version:1;createdAt:number;plans:Plan[];clients:Client[];photos:PhotoMeta[]}
export interface CheckedBackup {manifest:Manifest;photos:Photo[]}
async function hash(b:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(b).buffer))).map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function makeBackup(){
 const data=await snapshot();
 const size=data.photos.reduce((s,p)=>s+p.blob.size,0);if(size>MAX)throw Error('Копия превышает безопасный для этой версии размер 256 МБ. Данные не изменены.');
 const files:Record<string,Uint8Array>={};const photos:PhotoMeta[]=[];
 for(const p of data.photos){const bytes=new Uint8Array(await p.blob.arrayBuffer());const path=`photos/${p.id}`;files[path]=bytes;const {blob,...meta}=p;photos.push({...meta,path,size:bytes.length,sha256:await hash(bytes)});}
 const manifest:Manifest={format:'otgruzki-backup',version:1,createdAt:Date.now(),plans:data.plans,clients:data.clients,photos};
 const meta=strToU8(JSON.stringify(manifest));files['data.json']=meta;files['data.sha256']=strToU8(await hash(meta));
 const zipped=zipSync(files,{level:0});if(zipped.byteLength>MAX)throw Error('Копия больше 256 МБ. Данные не изменены.');
 return new File([new Uint8Array(zipped).buffer],`Отгрузки-${new Date().toLocaleDateString('sv-SE')}.zip`,{type:'application/zip'});
}
export async function checkBackup(file:File):Promise<CheckedBackup>{
 if(file.size>MAX)throw Error('Файл превышает допустимый размер 256 МБ.');
 let total=0,entries=0;let files:Record<string,Uint8Array>;
 try{files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{total+=entry.originalSize;entries++;if(total>MAX||entries>10000||entry.name.includes('..')||entry.name.startsWith('/'))throw Error('Недопустимый архив');return true;}});}catch{throw Error('Не удалось прочитать архив: файл повреждён или слишком большой.');}
 if(!files['data.json']||!files['data.sha256']||await hash(files['data.json'])!==strFromU8(files['data.sha256']).trim())throw Error('Повреждены данные резервной копии.');
 let m:Manifest;try{m=JSON.parse(strFromU8(files['data.json']));}catch{throw Error('Некорректный файл данных.');}
 if(m.format!=='otgruzki-backup'||m.version!==1||!Number.isFinite(m.createdAt)||!Array.isArray(m.plans)||!Array.isArray(m.clients)||!Array.isArray(m.photos))throw Error('Неподдерживаемый формат резервной копии.');
 validateClients(m.clients);const planIds=new Set<string>(),rowIds=new Set<string>();
 for(const p of m.plans){validatePlan(p,m.clients);if(planIds.has(p.id))throw Error('В копии повторяются планы.');planIds.add(p.id);for(const r of p.rows){if(rowIds.has(r.id))throw Error('В копии повторяются строки клиентов.');rowIds.add(r.id);}}
 const photos:Photo[]=[];const photoIds=new Set<string>();const paths=new Set(['data.json','data.sha256']);
 for(const p of m.photos){
  if(!p||typeof p.id!=='string'||photoIds.has(p.id)||p.path!==`photos/${p.id}`||typeof p.name!=='string'||!['image/jpeg','image/png','image/webp'].includes(p.mime)||!Number.isFinite(p.createdAt)||!Number.isSafeInteger(p.size)||p.size<=0)throw Error('Некорректное описание фотографии.');
  if(!m.plans.find(plan=>plan.id===p.planId)?.rows.some(r=>r.id===p.rowId))throw Error('У фотографии отсутствует строка клиента.');
  const bytes=files[p.path];if(!bytes||bytes.length!==p.size||await hash(bytes)!==p.sha256)throw Error('Фотография отсутствует или повреждена.');
  await checkImage(new Blob([new Uint8Array(bytes).buffer],{type:p.mime}));
  photoIds.add(p.id);paths.add(p.path);const {path,size,sha256,...meta}=p;photos.push({...meta,blob:new Blob([new Uint8Array(bytes).buffer],{type:p.mime})});
 }
 if(Object.keys(files).some(path=>!paths.has(path)))throw Error('Архив содержит неизвестные файлы.');
 return {manifest:m,photos};
}
export async function restoreBackup(checked:CheckedBackup,target:AppDB=db){
 // Validate again immediately before mutation; the UI cannot accidentally bypass checks.
 validateClients(checked.manifest.clients);for(const p of checked.manifest.plans)validatePlan(p,checked.manifest.clients);
 await target.transaction('rw',target.plans,target.clients,target.photos,async()=>{
  await target.plans.clear();await target.clients.clear();await target.photos.clear();
  await target.clients.bulkAdd(checked.manifest.clients);await target.plans.bulkAdd(checked.manifest.plans);await target.photos.bulkAdd(checked.photos);
 });
}
export function checkImage(blob:Blob):Promise<void>{return new Promise((resolve,reject)=>{const url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve()};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Фотография не читается. Выберите JPEG, PNG или WebP.'))};img.src=url;});}
export async function preparePhoto(file:File):Promise<{blob:Blob;mime:string}>{
 if(!file.type.startsWith('image/')||file.size>30*1024*1024)throw Error('Выберите изображение размером до 30 МБ.');
 // Decode and normalize iPhone input, retaining full resolution for document codes.
 const url=URL.createObjectURL(file);
 try{const img=new Image();img.src=url;await img.decode();if(img.naturalWidth*img.naturalHeight>55e6)throw Error('Изображение слишком большое. Выберите снимок до 55 мегапикселей.');const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Не удалось подготовить фото.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Не удалось сохранить фотографию.')),'image/jpeg',.94));return {blob,mime:'image/jpeg'};}catch(e){throw Error(e instanceof Error&&e.message.includes('больш')?e.message:'Не удалось прочитать фото. Попробуйте снимок JPEG из камеры iPhone.');}finally{URL.revokeObjectURL(url);}
}
