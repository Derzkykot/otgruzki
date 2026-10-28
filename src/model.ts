export const SUPPLIERS = { 'Руно': ['60е','73/76v','89','108'], 'Беркут': ['73/76 новые'] } as const;
export type Supplier = keyof typeof SUPPLIERS;
export const METHODS = {pickup:'Самовывоз с моего склада',transport:'Доставка нашим транспортом',tk:'Отправка транспортной компанией'} as const;
export type Method = keyof typeof METHODS;
export interface Client {id:string;name:string}
export interface Position {expected:number;actual:number|null;confirmed:boolean}
export interface Allocation {id:string;clientId:string;method:Method;comment:string;quantities:Record<string,number>}
export const MOVES = {direct_customer:'Напрямую клиенту нашим транспортом',direct_tk:'Напрямую в ТК',warehouse_in:'Пригодные поступили на склад',warehouse_bad_in:'Учтённый брак поступил на склад',warehouse_pickup:'Выдача самовывозом со склада',warehouse_customer:'Передача клиенту со склада нашим транспортом',warehouse_tk:'Передача со склада в ТК',defect_on:'Обнаружен брак на складе',defect_off:'Обнаружен брак вне склада'} as const;
export type MoveKind=keyof typeof MOVES;
export interface Movement {id:string;type:string;kind:MoveKind;quantity:number;rowId?:string;createdAt:number}
export interface Plan {id:string;supplier:Supplier;date:string;createdAt:number;revision:number;positions:Record<string,Position>;rows:Allocation[];moves:Movement[]}
export interface Photo {id:string;planId:string;rowId:string;name:string;mime:string;createdAt:number;blob:Blob}
export const id=()=>crypto.randomUUID();
export const isShipment=(k:MoveKind)=>['direct_customer','direct_tk','warehouse_pickup','warehouse_customer','warehouse_tk'].includes(k);
export const isDirect=(k:MoveKind)=>k==='direct_customer'||k==='direct_tk';
export function shipped(p:Plan,rowId:string,type:string){return p.moves.filter(m=>m.rowId===rowId&&m.type===type&&isShipment(m.kind)).reduce((s,m)=>s+m.quantity,0)}
export function totals(p:Plan,type:string){
 const pos=p.positions[type];const events=p.moves.filter(m=>m.type===type);
 const sum=(...k:MoveKind[])=>events.filter(m=>k.includes(m.kind)).reduce((s,m)=>s+m.quantity,0);
 const base=pos.confirmed?pos.actual!:pos.expected;
 const defect=sum('defect_on','defect_off');const good=base-defect;
 const allocated=p.rows.reduce((s,r)=>s+(r.quantities[type]||0),0);
 const sent=events.filter(m=>isShipment(m.kind)).reduce((s,m)=>s+m.quantity,0);
 const stock=sum('warehouse_in')-sum('warehouse_pickup','warehouse_customer','warehouse_tk','defect_on');
 const badStock=sum('defect_on','warehouse_bad_in');
 return {base,defect,good,allocated,sent,reserve:allocated-sent,free:good-allocated,stock,badStock};
}
export function createPlan(supplier:Supplier,date:string):Plan{return {id:id(),supplier,date,createdAt:Date.now(),revision:0,positions:Object.fromEntries(SUPPLIERS[supplier].map(t=>[t,{expected:0,actual:null,confirmed:false}])),rows:[],moves:[]}}
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=1e9;
export function validatePlan(p:Plan,clients:Client[]){
 if(!p||typeof p.id!=='string'||!Object.hasOwn(SUPPLIERS,p.supplier)||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(p.createdAt)||!count(p.revision)||!Array.isArray(p.rows)||!Array.isArray(p.moves))throw Error('Некорректный план.');
 const day=new Date(p.date+'T00:00:00Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==p.date)throw Error('Некорректная дата партии.');
 const types=SUPPLIERS[p.supplier] as readonly string[];
 if(!p.positions||Object.keys(p.positions).sort().join('|')!==[...types].sort().join('|'))throw Error('Типы винтов не соответствуют поставщику.');
 const rowIds=new Set<string>();const moveIds=new Set<string>();
 for(const t of types){const v=p.positions[t];if(!v||!count(v.expected)||!(v.actual===null||count(v.actual))||typeof v.confirmed!=='boolean'||(v.confirmed&&v.actual===null))throw Error('Проверьте ожидаемое и фактическое количество.');}
 for(const r of p.rows){if(!r||typeof r.id!=='string'||rowIds.has(r.id)||!clients.some(c=>c.id===r.clientId)||!Object.hasOwn(METHODS,r.method)||typeof r.comment!=='string'||r.comment.length>10000||!r.quantities)throw Error('Проверьте клиента, способ получения и комментарий.');rowIds.add(r.id);for(const [t,q]of Object.entries(r.quantities))if(!types.includes(t)||!count(q))throw Error('Некорректное распределение.');}
 const stock:Record<string,number>={},outsideBad:Record<string,number>={};
 for(const t of types){stock[t]=0;outsideBad[t]=0;}
 for(const m of p.moves){
  if(!m||typeof m.id!=='string'||moveIds.has(m.id)||!types.includes(m.type)||!Object.hasOwn(MOVES,m.kind)||!count(m.quantity)||m.quantity===0||!Number.isFinite(m.createdAt))throw Error('Некорректная запись движения.');moveIds.add(m.id);
  if(!p.positions[m.type].confirmed)throw Error(`Сначала подтвердите фактическое количество ${m.type}.`);
  if(isShipment(m.kind)){
   const r=p.rows.find(r=>r.id===m.rowId);if(!r)throw Error('У отгрузки отсутствует клиент.');
   const method=m.kind.endsWith('tk')?'tk':m.kind==='warehouse_pickup'?'pickup':'transport';
   if(r.method!==method)throw Error('Способ отгрузки не соответствует способу получения клиента.');
  }else if(m.rowId!==undefined)throw Error('У складского движения не должно быть клиента.');
  if(m.kind==='warehouse_in')stock[m.type]+=m.quantity;
  if(['warehouse_pickup','warehouse_customer','warehouse_tk','defect_on'].includes(m.kind))stock[m.type]-=m.quantity;
  if(m.kind==='defect_off')outsideBad[m.type]+=m.quantity;
  if(m.kind==='warehouse_bad_in')outsideBad[m.type]-=m.quantity;
  if(stock[m.type]<0)throw Error(`Недостаточно пригодных ${m.type} на складе. Проверьте порядок движений.`);
  if(outsideBad[m.type]<0)throw Error('На склад можно принять только ранее учтённый вне склада брак.');
 }
 for(const t of types){
  const s=totals(p,t);if(s.good<0)throw Error(`Брак ${t} превышает количество партии.`);
  for(const r of p.rows)if(shipped(p,r.id,t)>(r.quantities[t]||0))throw Error(`Отгружено ${t} больше, чем выделено клиенту. Сначала увеличьте распределение.`);
  const used=p.moves.filter(m=>m.type===t&&(isDirect(m.kind)||m.kind==='warehouse_in'||m.kind==='defect_off')).reduce((s,m)=>s+m.quantity,0);
  if(used>s.base)throw Error(`Движения ${t} превышают фактически полученное количество. Проверьте приход, прямые отгрузки и брак.`);
 }
}
export function validateClients(clients:Client[]){const ids=new Set<string>(),names=new Set<string>();for(const c of clients){if(!c||typeof c.id!=='string'||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>200||names.has(c.name.trim().toLocaleLowerCase('ru')))throw Error('Некорректный справочник клиентов или повторяющиеся названия.');ids.add(c.id);names.add(c.name.trim().toLocaleLowerCase('ru'));}}
