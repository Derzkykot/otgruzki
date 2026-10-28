import {readFile,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';

const root=resolve('dist');
async function exists(path){if(!(await stat(resolve(root,path))).isFile())throw Error(`Missing release file: ${path}`);}
const html=await readFile(resolve(root,'index.html'),'utf8');
const manifest=JSON.parse(await readFile(resolve(root,'manifest.webmanifest'),'utf8'));
const sw=await readFile(resolve(root,'sw.js'),'utf8');
if(manifest.display!=='standalone'||manifest.start_url!=='./'||manifest.scope!=='./')throw Error('PWA must support GitHub Pages subdirectory installation.');
for(const file of ['sw.js','manifest.webmanifest','apple-touch-icon.png','.nojekyll',...manifest.icons.map(i=>i.src)])await exists(file);
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
 const path=match[1];if(/^(https?:)?\/\//.test(path)||path.startsWith('/'))throw Error(`App resource is not local or subdirectory-safe: ${path}`);
 if(!resolve(root,path).startsWith(root+sep))throw Error('Resource escapes the release directory.');
 await exists(path);
}
const urls=JSON.parse(sw.match(/const URLS=(\[[^\n]+\]);/)[1]);
for(const path of urls)await exists(path);
if(!urls.includes('./index.html')||!urls.some(p=>p.startsWith('./assets/')&&p.endsWith('.js')))throw Error('Incomplete offline cache.');
console.log(`Release verified: ${urls.length} local cached files; relative paths support GitHub Pages.`);
