/** Retire the Maestro service route after installing its browser replacements.
 * Run in repository root with Next.js stopped. Does not claim the remaining
 * FCT/SPARQL routes are CORS-only. */
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
const root=process.cwd(),service=join(root,'src','app','proxy','api','service'),observations=join(root,'src','app','proxy','api','observations');
async function exists(path){try{await stat(path);return true;}catch{return false;}}
async function* sourceFiles(dir){if(!await exists(dir))return;for(const ent of await readdir(dir,{withFileTypes:true})){
 const path=join(dir,ent.name);if(ent.isDirectory())yield* sourceFiles(path);
 else if(/\.(?:tsx?|mjs|js|cjs)$/.test(ent.name))yield path;
}}
for(const file of ['src/lib/client-otc-runner.ts','src/lib/client-otc-import.ts','src/lib/service-client.ts'])
 if(!await exists(join(root,file)))throw new Error(`Missing ${file}; no files were deleted.`);
for await(const file of sourceFiles(join(root,'src'))){
 if(file.startsWith(service+sep)||file.startsWith(observations+sep)||file.includes(`${sep}scripts${sep}migration${sep}`))continue;
 if(/\/proxy\/api\/(?:service|observations)(?:\?|["'`]|$)/.test(await readFile(file,'utf8')))
   throw new Error(`Legacy service API still called by ${relative(root,file)}; no files were deleted.`);
}
for(const path of [service,observations])if(await exists(path)){await rm(path,{recursive:true,force:true});console.log(`Retired ${relative(root,path)}`);}
if(await exists(join(root,'.next')))await rm(join(root,'.next'),{recursive:true,force:true});
console.log('Service and observations APIs retired; FCT/SPARQL still require migration.');
