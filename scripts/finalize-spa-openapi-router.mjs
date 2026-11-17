/** Apply after the changed-files overlay. Delete only obsolete Maestro RPC
 * handlers and the superseded fifth forwarding route, never the user's
 * four designated HTTP endpoints. Idempotent and fails closed on old callers. */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join,relative } from 'node:path';
const root=process.cwd();
const src=join(root,'src');
const route=join(src,'app/proxy/api/service/route.ts');
if(!existsSync(route) || !readFileSync(route,'utf8').includes('OpenAPI-only allowlist router'))
  throw new Error('Expected the new OpenAPI /service router. Apply the ZIP first.');
for(const name of ['fct','observations','sparql'])
  if(!existsSync(join(src,`app/proxy/api/${name}/route.ts`)))
    throw new Error(`Protected route /${name} is missing; refusing to clean up.`);
const exclude=new Set(['app/proxy/api/service/operations.ts']);
function scan(folder){
  if(!existsSync(folder))return [];
  const out=[];
  for(const entry of readdirSync(folder,{withFileTypes:true})){
    const full=join(folder,entry.name),relativeName=relative(src,full).replaceAll('\\','/');
    if(relativeName.startsWith('app/proxy/api/service/handlers/')||exclude.has(relativeName)||relativeName.startsWith('scripts/'))continue;
    if(entry.isDirectory())out.push(...scan(full));
    else if(/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)){
      const contents=readFileSync(full,'utf8');
      if(contents.includes('/proxy/api/forward')||contents.includes('/proxy/api/service?service=maestro')||
          /from\s+['"]@\/app\/proxy\/api\/service\/operations/.test(contents))out.push(relativeName);
    }
  }
  return out;
}
const remaining=scan(src);
if(remaining.length)throw new Error(`Old HTTP service callers remain: ${remaining.join(', ')}`);
const serviceFolder=join(src,'app/proxy/api/service');
for(const part of ['operations.ts','handlers']){
  const full=join(serviceFolder,part);
  if(existsSync(full)){rmSync(full,{recursive:true,force:true});console.log(`Removed ${relative(root,full)}`);}
}
// A previous (incorrect) overlay may have added this fifth route. It is not
// part of the pre-SPA baseline and is no longer referenced by browser code.
const forward=join(src,'app/proxy/api/forward');
if(existsSync(forward)){rmSync(forward,{recursive:true,force:true});console.log(`Removed ${relative(root,forward)}`);}
const routeNames=[];
function findRoutes(folder){if(!existsSync(folder))return;
  for(const e of readdirSync(folder,{withFileTypes:true})){const f=join(folder,e.name);
    if(e.isDirectory())findRoutes(f);else if(e.name==='route.ts')routeNames.push(relative(src,f).replaceAll('\\','/'));
  }}
findRoutes(join(src,'app'));
const expected=['app/proxy/api/fct/route.ts','app/proxy/api/observations/route.ts',
  'app/proxy/api/service/route.ts','app/proxy/api/sparql/route.ts'].sort();
if(JSON.stringify(routeNames.sort())!==JSON.stringify(expected))
  throw new Error(`Expected exactly four API routes; found ${routeNames.join(', ')}`);
console.log('SPA routing boundary OK: service, observations, fct, sparql.');
