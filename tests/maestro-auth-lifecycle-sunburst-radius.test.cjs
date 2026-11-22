'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
test('final personal success belongs to verified XState, not the seed action',()=>{
  const login=read('src/canvas/controllers/authentication.ts');
  const access=read('src/canvas/diagnostics/use-maestro-access.ts');
  const avatar=read('src/canvas/top/appbar-pane.tsx');
  assert.doesNotMatch(login,/title: "Graphs loaded"/);
  assert.match(login,/await refreshAuthBootstrap\(session, attempt\.signal\);/);
  assert.match(login,/setPersonalPoliciesReady\(true\);/);
  assert.match(access,/stage === "ready"/);
  assert.match(access,/title: "Personal graphs ready"/);
  assert.match(access,/machineForTarget\(machines, target\)/);
  assert.match(avatar,/workspace\.accessCapabilities\.policyError/);
});
test('concurrent login/restore/logout attempts cannot publish stale readiness',()=>{
  const initialization=read('src/lib/personal-initialization.ts');
  const controller=read('src/canvas/controllers/authentication.ts');
  const appbar=read('src/canvas/top/appbar-pane.tsx');
  assert.match(initialization,/active\?\.abort\(\)/);
  assert.match(initialization,/attempt\.revision === revision && !attempt\.signal\.aborted/);
  assert.match(controller,/beginPersonalInitialization\(\)/);
  assert.match(controller,/if \(!isCurrentPersonalInitialization\(attempt\)\) return;/);
  assert.match(controller,/seedPersonalGraphs\(attempt\.signal\)/);
  assert.match(appbar,/cancelPersonalInitialization\(\)/);
});
test('Categories tree is requested by RDF provider, without overriding manual disable',()=>{
  const host=read('src/canvas/left/facet-presentation.tsx');
  const filters=read('src/canvas/left/filter-pane.tsx');
  assert.match(host,/\?requestsClassTree/);
  assert.match(host,/wantsClassTree:active && Boolean\(provider\?\.requestsClassTree\)/);
  assert.match(filters,/manualTreeOverride\.current\.has\(classTreeScope\)/);
  assert.match(filters,/setQueryAttribute\("classTree", "true"\)/);
  for(const file of ['graph/sunburst/provider.ttl','graph/sunburst-chartkit/provider.ttl'])
    assert.match(read(file),/mui:requestsClassTree true/);
});
test('sunburst maximum radius slider resizes locally without FCT or XSLT rerun',()=>{
  const host=read('src/canvas/left/facet-presentation.tsx');
  assert.match(host,/Maximum sunburst radius/);
  assert.match(host,/const \[maxRadius,setMaxRadius\]=useState\(200\)/);
  assert.match(host,/onValueChange=\{values=>setMaxRadius/);
  assert.match(host,/style=\{\{maxWidth:`\$\{maxRadius\*2\+20\}px`\}\}/);
  assert.doesNotMatch(host,/\$\{maxRadius\}[^;]*transformWithMaestroSaxon/);
});
test('disconnect keeps remembered credentials, while Forget Account erases them',()=>{
  const auth=read('src/lib/personal-auth.ts');
  const appbar=read('src/canvas/top/appbar-pane.tsx');
  const disconnect=auth.split('export function disconnectPersonalAuthSession(): void {')[1];
  assert.ok(disconnect);
  assert.doesNotMatch(disconnect,/removeItem\(STORAGE_KEY\)/);
  assert.match(appbar,/disconnectPersonalAuthSession\(\)/);
  assert.match(appbar,/<span>Forget Account<\/span>/);
  assert.match(appbar,/clearPersonalAuthSession\(\)/);
});
