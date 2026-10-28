import {it,expect} from 'vitest';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';

it('cold offline navigation loads cached HTML and a module even with Vary: Origin',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'otgruzki-sw-'));
 try{
  await mkdir(join(dir,'dist/assets'),{recursive:true});
  await writeFile(join(dir,'dist/index.html'),'<main>app</main>');
  await writeFile(join(dir,'dist/assets/app.js'),'app-module');
  await writeFile(join(dir,'dist/.nojekyll'),'');
  const result=spawnSync(process.execPath,[resolve('scripts/service-worker.mjs')],{cwd:dir});
  expect(result.status).toBe(0);
  const source=await readFile(join(dir,'dist/sw.js'),'utf8');
  expect(source).not.toContain('./.nojekyll');
  const handlers={},store=new Map();
  const cache={addAll:async urls=>{for(const u of urls)store.set(u,u.endsWith('.js')?'app-module':'<main>app</main>')},match:async(request,options)=>{if(typeof request!=='string'&&!options?.ignoreVary)return undefined;const text=store.get(typeof request==='string'?request:request.url);return text?new Response(text):undefined}};
  const self={registration:{scope:'https://example.test/app/'},location:{origin:'https://example.test'},clients:{claim:async()=>{}},addEventListener:(name,handler)=>handlers[name]=handler};
  runInNewContext(source,{self,URL,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:()=>{throw Error('Network is offline')}});
  let work;handlers.install({waitUntil:p=>work=p});await work;
  let response;handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://example.test/app/'},respondWith:p=>response=p});
  expect(await (await response).text()).toBe('<main>app</main>');
  handlers.fetch({request:{method:'GET',mode:'cors',url:'https://example.test/app/assets/app.js'},respondWith:p=>response=p});
  expect(await (await response).text()).toBe('app-module');
 }finally{await rm(dir,{recursive:true,force:true});}
});
