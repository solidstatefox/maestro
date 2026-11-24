const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const src = rel => fs.readFileSync(path.join(root,rel),'utf8');

test('Sheet Debug contains every known URL diagnostic switch and reloads the latest URL without touching q/hash', () => {
  const defs = src('src/lib/maestro-debug-url.ts');
  const component = src('src/canvas/sheet/debug-settings.tsx');
  const sheet = src('src/canvas/sheet/settings-pane.tsx');
  assert.match(defs,/key: "maestroDebug", label: "Record performance"/);
  assert.match(defs,/key: "maestroLifecycle", label: "Application lifecycle"/);
  assert.match(component, /<MaestroSelect/);
  assert.match(component,/value=\{selections\[definition.key\]\}/);
  assert.match(component,/window.location.assign\(urlWithMaestroDebugSettings\(window.location.href, selections\)\)/);
  assert.match(sheet,/<MaestroDebugSettings active=\{controlsSheetOpen\}/);
  const ts = require('typescript');
  const js = ts.transpileModule(defs,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js,{exports:module.exports,module,URL,URLSearchParams,Object,String});
  const api=module.exports;
  const original='https://example.test/path?q=%3Cquery%20id%3D%22a%22%2F%3E&tab=Browse&colorBy=blue#record';
  const changed=api.urlWithMaestroDebugSettings(original,{maestroDebug:'record',maestroLifecycle:'1'});
  const u=new URL(changed);
  assert.equal(u.searchParams.get('q'),'<query id="a"/>');
  assert.equal(u.searchParams.get('tab'),'Browse');
  assert.equal(u.searchParams.get('colorBy'),'blue');
  assert.equal(u.hash,'#record');
  assert.equal(u.searchParams.get('maestroDebug'),'record');
  assert.equal(u.searchParams.get('maestroLifecycle'),'1');
  const reset=new URL(api.urlWithMaestroDebugSettings(changed,{maestroDebug:'',maestroLifecycle:''}));
  assert.equal(reset.searchParams.has('maestroDebug'),false);
  assert.equal(reset.searchParams.has('maestroLifecycle'),false);
  assert.equal(reset.searchParams.get('q'),'<query id="a"/>');
});

test('Record instrumentation remains URL opt-in, and proxy DESCRIBE clock remains independent',()=>{
  const perf=src('src/lib/record-performance.ts');
  assert.match(perf, /get\("maestroDebug"\) === "record"/);
  const panel=src('src/canvas/right/record-performance-debug.tsx');
  assert.match(panel,/if \(!recordPerformanceDebugEnabled\(\)\) return/);
  const record=src('src/canvas/utils/workspace-controller.tsx');
  assert.match(record,/"initial"/);
  assert.match(record,/"complete"/);
  assert.match(record,/maestro-record-enrichment-skeleton/);
  assert.match(record,/maestro-record-enrichment-unavailable/);
  const xslt=src('src/lib/maestro-xslt.ts');
  assert.match(xslt,/renderStage: "initial" \| "complete"/);
  assert.match(xslt,/phaseParam && renderStage === "complete"/);
  assert.match(src('src/lib/maestro-query-execution-clock.ts'),/dispatch|completed|dispatched/i);
});

test('Personal auth persists completed HTTP status, while Digest and XState remain authoritative',()=>{

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
    require: id => id === 'xstate' ? require('xstate') : require(id),
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

test('EURIO Research Result uses Project banner structure; domain result type links and abstract appear before other sections',()=>{
  const xsl=src('graph/eu-data/record.xsl');
  const result=xsl.slice(xsl.indexOf('<xsl:template name="RecordResult">'));
  assert.match(result,/eu-result-status-rail[^\n]*bg-black/);
  assert.match(result,/eu-result-banner-brand/);
  assert.match(result,/eu-result-domain-types/);
  assert.match(result,/name="project-atom"/);
  assert.match(result,/name="resultTypeRows"[^\n]*hasResultType/);
  assert.match(result,/id="eu-result-domain-types"[\s\S]*?select="\$resultTypeRows"/);
  assert.doesNotMatch(result,/id="eu-result-specific-type"/);
  const banner=result.slice(result.indexOf('id="eu-result-banner"'),result.indexOf('id="eu-result-title-area"'));
  for(const item of ['journal','publisher','year']) assert.ok(banner.includes(`id="eu-result-${item}"`));
  assert.doesNotMatch(banner,/eu-result-domain-type/);
  assert.doesNotMatch(result, /id="eu-result-types-heading"/);
  assert.doesNotMatch(result, /id="eu-result-abstract-heading"/);
  assert.ok(result.indexOf('id="eu-result-abstract"')>result.indexOf('id="eu-result-domain-types"'));
  assert.match(src('tools/compile-eurio-record-sef.mjs'),/sourceSha256|createHash/);
  assert.match(src('src/lib/maestro-browser-xslt.ts'),/xslt-compiled-sef-render/);
  assert.equal(src('graph/eu-data/provider.ttl').split(`mui:templateContent """${xsl.replace(/\\/g,'\\\\')}`).length-1,1);
});
