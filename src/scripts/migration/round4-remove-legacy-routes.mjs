/** Round 4 cleanup, safe on Windows/PowerShell. Extract the ZIP first.
 * Stop Next.js, run `node src/scripts/migration/round4-remove-legacy-routes.mjs`,
 * then `npm.cmd run build`. Never delete old routes before inspecting callers. */
import {readdir, readFile, rm, stat} from "node:fs/promises";
import {join, relative, sep} from "node:path";
const root=process.cwd();
const paths=['src/app/proxy/api/appbar-buttons', 'src/app/proxy/api/auth', 'src/app/proxy/api/bookmark-analysis', 'src/app/proxy/api/graph-seed', 'src/app/proxy/api/ontology', 'src/app/proxy/api/otc', 'src/app/proxy/api/otc/chat', 'src/app/proxy/api/otc/import', 'src/app/proxy/api/personal-facet-providers', 'src/app/proxy/api/perspectives', 'src/app/proxy/api/policies', 'src/app/proxy/api/query-favorites', 'src/app/proxy/api/record-status', 'src/app/proxy/api/services'];
const oldUrls=['/proxy/api/appbar-buttons', '/proxy/api/auth', '/proxy/api/bookmark-analysis', '/proxy/api/graph-seed', '/proxy/api/ontology', '/proxy/api/otc', '/proxy/api/otc/chat', '/proxy/api/otc/import', '/proxy/api/personal-facet-providers', '/proxy/api/perspectives', '/proxy/api/policies', '/proxy/api/query-favorites', '/proxy/api/record-status', '/proxy/api/services'];
const required=["src/app/proxy/api/service/route.ts","src/app/proxy/api/service/operations.ts",
  ...['src/app/proxy/api/service/handlers/appbar-buttons.ts', 'src/app/proxy/api/service/handlers/auth.ts', 'src/app/proxy/api/service/handlers/bookmark-analysis.ts', 'src/app/proxy/api/service/handlers/graph-seed.ts', 'src/app/proxy/api/service/handlers/ontology.ts', 'src/app/proxy/api/service/handlers/otc.ts', 'src/app/proxy/api/service/handlers/otc-chat.ts', 'src/app/proxy/api/service/handlers/otc-import.ts', 'src/app/proxy/api/service/handlers/personal-facet-providers.ts', 'src/app/proxy/api/service/handlers/perspectives.ts', 'src/app/proxy/api/service/handlers/policies.ts', 'src/app/proxy/api/service/handlers/query-favorites.ts', 'src/app/proxy/api/service/handlers/record-status.ts', 'src/app/proxy/api/service/handlers/services.ts']];
async function exists(path){ try { await stat(path); return true; }catch{return false;} }
for(const file of required) if(!await exists(join(root,file))) throw new Error(`Missing ${file}; extract the Round 4 overlay before cleanup.`);
async function* sourceFiles(directory){ if(!await exists(directory))return;
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=join(directory,entry.name);
  if(entry.isDirectory()) yield* sourceFiles(file);
  else if(/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name))yield file;
 }}
const oldDirectories=paths.map(dir=>join(root,dir)+sep);
for(const folder of ["src","scripts","public"]){
 for await(const file of sourceFiles(join(root,folder))){
  if(oldDirectories.some(path=>file.startsWith(path)) || file.includes(`${sep}round4${sep}handlers${sep}`) || file.endsWith("remove-legacy-routes.mjs")) continue;
  const content=await readFile(file,"utf8");
  for(const oldUrl of oldUrls){
   // All old paths must be retired; also exclude partial substring matches like /otc in /otc/chat.
   if(content.includes('"'+oldUrl+'"') || content.includes("'"+oldUrl+"'") || content.includes("`"+oldUrl+"`"))
    throw new Error(`Old caller in ${relative(root,file)}: ${oldUrl}. No routes were deleted.`);
  }
 }
}
for(const path of [...paths].sort((a,b)=>b.length-a.length)){const full=join(root,path);if(await exists(full)){
 // Nested OTC routes are removed before the parent OTC directory.
 await rm(full,{recursive:true,force:true}); console.log(`Removed ${path}`);
}}
const cache=join(root,".next");if(await exists(cache)){await rm(cache,{recursive:true,force:true});console.log("Cleared stale Next.js route cache");}
console.log("Round 4: retired 14 old route directories; /fct, /sparql, /service, /observations are the only /proxy/api HTTP routes.");
