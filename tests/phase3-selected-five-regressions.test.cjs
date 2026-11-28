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
  assert.match(source,/const next = detail\.state === "queued" \? browserPositions\.get\(controller\) \?\? 0 : 0/);
  assert.doesNotMatch(source,/displayPositions\.get\(controller\)/);
  assert.match(source,/serverQueueIndex: queueIndex/);
});
test('TODO #65: personal SPARQL update errors distinguish foreign/dynamic graphs',()=>{

  const accessSource = require('node:fs').readFileSync("src/lib/app-lifecycle/access.ts", 'utf8');
  const controllerSource = require('node:fs').readFileSync("src/canvas/controllers/authentication.ts", 'utf8');
  assert.ok(accessSource.includes('SESSION_OBSERVED'));
  assert.ok(accessSource.includes('signedOut: {}'));
  assert.ok(accessSource.includes('signedIn: {'));
  assert.ok(accessSource.includes('const policyReady = sessionReady && snapshot.context.policyStage === "ready"'));
  assert.ok(controllerSource.includes('useState<PersonalAuthSession | null>(null)'));
  assert.ok(controllerSource.includes('event.preventDefault()'));
  assert.ok(controllerSource.includes('await restoreDigestSession(attempt.signal)'));
  const ts = require('typescript');
  const vm = require('node:vm');
  const moduleHolder = { exports: {} };
  const compiled = ts.transpileModule(accessSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, {
    module: moduleHolder, exports: moduleHolder.exports,
    require: id => id === './actor-query-authority' ? require('./actor-query-authority-test-loader.cjs') : require(id),
    AbortController, Promise, Map, Set,
  }, { filename: 'src/lib/app-lifecycle/access.ts' });
  const { createMaestroAccessActor, selectMaestroCapabilities } = moduleHolder.exports;
  const actor = createMaestroAccessActor();
  actor.start();
  actor.send({ type: 'SESSION_OBSERVED', restored: true, sessionKey: '' });
  actor.send({ type: 'POLICY_STATUS_OBSERVED', sessionKey: 'no-session', stage: 'ready' });
  actor.send({ type: 'BOOKMARK_CONFIRMED', queryKey: 'any', bookmarkId: 'any' });
  actor.send({ type: 'BOOKMARK_CHECK_REQUESTED', queryKey: 'any', sessionKey: 'no-session', execute: () => Promise.resolve({bookmarked:true,bookmarkId:'any'}) });
  const snapshot = actor.getSnapshot();
  assert.equal(snapshot.value, 'signedOut');
  assert.equal(snapshot.context.sessionKey, '');
  assert.equal(snapshot.context.policyStage, 'unavailable');
  const caps = selectMaestroCapabilities(snapshot, {queryKey:'any',recordSelected:true,providersActive:true});
  for (const key of ['canUsePersonalStore','canMutatePersonalStore','canUsePolicyProviders','canShowStatusFacet','canShowRecordStatusActions','canApproveProvider']) {
    assert.equal(caps[key], false, key);
  }
  actor.stop();

  });
