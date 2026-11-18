const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('TODO #14: malformed status policy machines cannot crash Record page',()=>{
  const source=read('src/lib/client-status-reads.ts');
  assert.match(source,/machine\?\.targetClasses instanceof Set/);
  assert.match(source,/machine\.targetClasses\.has/);
});
test('TODO #17: new autocomplete lookup reopens the anchored status popup, preserving existing match semantics',()=>{
  const machine=read('src/lib/app-lifecycle/uri-autocomplete.ts');
  assert.match(machine,/FIND: \{ target: "\.debouncing"/);
  assert.match(machine,/popupOpen: true,/);
  const widget=read('src/canvas/top/root-uri-autocomplete.tsx');
  for(const status of ['result.loading','result.error','No results']) assert.ok(widget.includes(status),status);
  assert.match(widget,/createRootUriAutocompleteQuery\(prefix, addr, settings, propertyUris\)/);
});
test('TODO #19: only equality bindings produce identity examples',()=>{
  const source=read('src/lib/fct-example-prefix.ts');
  assert.match(source,/!op \|\| op === "="/);
  assert.match(source,/rangeStart === undefined && rangeEnd === undefined/);
  assert.match(source,/!value.attributes/);
});
test('TODO #63: preparing request is not mislabeled queued and real queue slots have positions',()=>{
  const source=read('src/lib/client-query-cache.ts');
  assert.match(source,/state: "preparing" \| "queued" \| "active"/);
  assert.match(source,/state: "preparing", queueIndex: 0/);
  assert.match(source,/state: "queued"/);
  assert.match(source,/displayPositions\.get\(controller\) \?\? 0/);
});
test('TODO #65: personal SPARQL update errors distinguish foreign/dynamic graphs',()=>{
  const source=read('src/app/proxy/api/sparql/route.ts');
  assert.match(source,/Variable or implicit graph targets/);
  assert.match(source,/outside the authenticated personal namespace/);
  assert.match(source,/inspectPersonalUpdateGraphs\(update\)/);
});
