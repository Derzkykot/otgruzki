import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function list(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.isDirectory())result.push(...await list(dir+'/'+entry.name));else if(entry.name!=='sw.js')result.push(dir+'/'+entry.name)}return result;}
const files=await list('dist');
const hash=createHash('sha256');hash.update(await readFile(new URL(import.meta.url)));for(const path of files){hash.update(path);hash.update(await readFile(path));}
const version=hash.digest('hex').slice(0,16);
const urls=files.map(f=>'./'+f.slice(5));
await writeFile('dist/sw.js',`const CACHE='otgruzki-${version}';
const URLS=${JSON.stringify(urls)};
const absolute=URLS.map(u=>new URL(u,self.registration.scope).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(absolute);})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('otgruzki-')&&name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'){event.respondWith(caches.open(CACHE).then(c=>c.match(new URL('./index.html',self.registration.scope).href)).then(r=>r||fetch(event.request)));return;}
 // These are versioned public app assets; the preview host can vary Origin headers
 // between precache requests and module requests. Never miss a cached module for that.
 if(absolute.includes(url.href))event.respondWith(caches.open(CACHE).then(c=>c.match(event.request,{ignoreVary:true})).then(r=>r||fetch(event.request)));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();if(event.data==='CACHE_READY')event.waitUntil((async()=>{const cache=await caches.open(CACHE);const present=await Promise.all(absolute.map(u=>cache.match(u)));event.ports[0]?.postMessage(present.every(Boolean));})());});
`);
console.log('Офлайн-кэш:',version,urls.length,'файлов');
