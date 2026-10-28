import 'fake-indexeddb/auto';
import {it,expect,beforeEach,afterAll} from 'vitest';
import {db,savePlan,addClient,AppDB,snapshot} from './db';
import {createPlan,id} from './model';
import {restoreBackup,makeBackup,checkBackup,type CheckedBackup} from './backup';
beforeEach(async()=>{await db.plans.clear();await db.clients.clear();await db.photos.clear()});
afterAll(()=>db.close());
it('сохраняет планы и справочник при повторном открытии базы',async()=>{await addClient({id:'c',name:'Клиент'});const p=createPlan('Руно','2026-10-28');await savePlan(p);const again=new AppDB();try{expect(await again.clients.get('c')).toEqual({id:'c',name:'Клиент'});expect((await again.plans.get(p.id))?.positions).toEqual(p.positions);}finally{again.close()}});
it('использует время создания, а не дату отгрузки или редактирования',async()=>{const a=createPlan('Руно','2026-12-01');a.createdAt=100;await savePlan(a);const b=createPlan('Беркут','2026-01-01');b.createdAt=200;await savePlan(b);await savePlan((await db.plans.get(a.id))!);expect((await db.plans.orderBy('createdAt').reverse().first())?.id).toBe(b.id)});
it('отклоняет устаревшую форму вместо потери изменений',async()=>{const p=createPlan('Руно','2026-10-28');await savePlan(p);await expect(savePlan(p)).rejects.toThrow('другом окне')});
it('возвращает базу целиком при ошибке восстановления в середине транзакции',async()=>{const p=createPlan('Руно','2026-10-28');await savePlan(p);const blob=new Blob(['photo'],{type:'image/jpeg'});const duplicate={id:id(),rowId:'row',planId:'p',name:'doc.jpg',mime:'image/jpeg',createdAt:1,blob};const b={manifest:{format:'otgruzki-backup',version:1,createdAt:1,plans:[],clients:[],photos:[]},photos:[duplicate,duplicate]} as CheckedBackup;await expect(restoreBackup(b)).rejects.toThrow();expect(await db.plans.get(p.id)).toBeDefined();expect(await db.photos.count()).toBe(0)});
it('экспортирует и восстанавливает полный набор планов и клиентов',async()=>{await addClient({id:'client',name:'СтройОпора'});const p=createPlan('Руно','2026-10-28');p.rows.push({id:'row',clientId:'client',method:'tk',comment:'ТК Луч',quantities:{'60е':100}});await savePlan(p);const expected=await snapshot();const file=await makeBackup();const copy=await checkBackup(file);await db.plans.clear();await db.clients.clear();await restoreBackup(copy);expect(await snapshot()).toEqual(expected)});
it('повреждённый файл не меняет существующую базу',async()=>{const p=createPlan('Руно','2026-10-28');await savePlan(p);await expect(checkBackup(new File(['broken'],'broken.zip'))).rejects.toThrow();expect(await db.plans.count()).toBe(1)});
it('повторное открытие той же версии сохраняет планы, клиентов и байты фотографий',async()=>{
 await addClient({id:'client',name:'Проверка сохранности'});const p=createPlan('Руно','2026-10-28');p.rows.push({id:'row',clientId:'client',method:'tk',comment:'Старый план',quantities:{'73/76v':100}});await savePlan(p);
 const blob=new Blob(['existing-document-photo'],{type:'image/jpeg'});await db.photos.add({id:'photo',planId:p.id,rowId:'row',name:'document.jpg',mime:'image/jpeg',createdAt:1,blob});
 const again=new AppDB();try{expect((await again.plans.get(p.id))?.rows[0].comment).toBe('Старый план');expect(await again.clients.count()).toBe(1);const photo=await again.photos.get('photo');expect(photo?.rowId).toBe('row');expect(await photo!.blob.text()).toBe('existing-document-photo');expect(again.verno).toBe(1);}finally{again.close();}
});
