import Dexie, {type Table} from 'dexie';
import {type Plan,type Client,type Photo,validatePlan,validateClients} from './model';
export class AppDB extends Dexie {
 plans!:Table<Plan,string>;clients!:Table<Client,string>;photos!:Table<Photo,string>;
 constructor(name='otgruzki-v1'){super(name);this.version(1).stores({plans:'id,createdAt',clients:'id,name',photos:'id,planId,rowId'});}
}
export const db=new AppDB();
export async function savePlan(plan:Plan,newClient?:Client){
 await db.transaction('rw',db.plans,db.clients,db.photos,async()=>{
  const before=await db.plans.get(plan.id);if(before&&before.revision!==plan.revision)throw Error('План изменён в другом окне. Закройте форму и повторите изменение.');
  if(newClient)await db.clients.add(newClient);
  const clients=await db.clients.toArray();validateClients(clients);validatePlan(plan,clients);
  if(before){const removed=before.rows.filter(r=>!plan.rows.some(n=>n.id===r.id));for(const r of removed)await db.photos.where('rowId').equals(r.id).delete();}
  const last=before?undefined:await db.plans.orderBy('createdAt').last();
  await db.plans.put({...plan,createdAt:before?.createdAt??Math.max(plan.createdAt,(last?.createdAt??0)+1),revision:(before?.revision??0)+1});
 });
}
export async function addClient(c:Client){await db.transaction('rw',db.clients,async()=>{validateClients([...(await db.clients.toArray()),c]);await db.clients.add(c);});}
export async function addPhotos(photos:Photo[]){await db.transaction('rw',db.photos,db.plans,async()=>{for(const p of photos){const plan=await db.plans.get(p.planId);if(!plan?.rows.some(r=>r.id===p.rowId))throw Error('Строка клиента больше не существует.');await db.photos.add(p);}});}
export async function snapshot(){return db.transaction('r',db.plans,db.clients,db.photos,async()=>({plans:await db.plans.toArray(),clients:await db.clients.toArray(),photos:await db.photos.toArray()}));}
