import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MovementForm} from './App';
import {createPlan,type Allocation,type Movement} from './model';

const client={id:'client',name:'Клиент'};
function fixture(){const plan=createPlan('Руно','2026-10-28');const row:Allocation={id:'row',clientId:client.id,method:'tk',comment:'',quantities:{'73/76v':100}};plan.rows.push(row);return {plan,row};}
function typeSelect(html:string){return html.match(/<select name="type"[\s\S]*?<\/select>/)![0];}
it('автоматически выбирает единственный выделенный тип вместо 60е',()=>{
 const {plan,row}=fixture();const html=typeSelect(renderToStaticMarkup(<MovementForm plan={plan} row={row} clients={[client]} onSubmit={()=>{}}/>));
 expect(html).toContain('value="73/76v" selected=""');expect(html).not.toContain('value="60е"');
});
it('предлагает выбор из нескольких типов с остатком, исключая полностью выданные',()=>{
 const {plan,row}=fixture();row.quantities={'60е':10,'73/76v':100,'89':50};plan.moves.push({id:'move',type:'60е',kind:'direct_tk',quantity:10,rowId:row.id,createdAt:1});
 const html=typeSelect(renderToStaticMarkup(<MovementForm plan={plan} row={row} clients={[client]} onSubmit={()=>{}}/>));
 expect(html).toContain('value="" disabled="" selected=""');expect(html).toContain('value="73/76v"');expect(html).toContain('value="89"');expect(html).not.toContain('value="60е"');expect(html).not.toContain('value="108"');
});
it('после частичной отгрузки показывает точное оставшееся количество',()=>{
 const {plan,row}=fixture();plan.moves.push({id:'move',type:'73/76v',kind:'direct_tk',quantity:60,rowId:row.id,createdAt:1});
 const html=renderToStaticMarkup(<MovementForm plan={plan} row={row} clients={[client]} onSubmit={()=>{}}/>);expect(html).toContain('73/76v — осталось 40');
});
it('блокирует новую отгрузку полностью выполненного клиента',()=>{
 const {plan,row}=fixture();plan.moves.push({id:'move',type:'73/76v',kind:'direct_tk',quantity:100,rowId:row.id,createdAt:1});
 const html=renderToStaticMarkup(<MovementForm plan={plan} row={row} clients={[client]} onSubmit={()=>{}}/>);expect(html).toContain('Всё отгружено');expect(html).toContain('class="primary full" disabled=""');
});
it('позволяет исправить старую отгрузку полностью выданного типа',()=>{
 const {plan,row}=fixture();const move:Movement={id:'move',type:'73/76v',kind:'direct_tk',quantity:100,rowId:row.id,createdAt:1};plan.moves.push(move);
 const html=typeSelect(renderToStaticMarkup(<MovementForm plan={plan} move={move} clients={[client]} onSubmit={()=>{}}/>));expect(html).toContain('value="73/76v" selected=""');expect(html).toContain('value="60е"');
});
