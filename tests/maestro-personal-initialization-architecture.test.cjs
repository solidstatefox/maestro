const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const read=x=>fs.readFileSync(x,'utf8');

test('retry keeps the existing Digest carrier; only explicit session change can disconnect it',()=>{
  const src=read('src/canvas/controllers/authentication.ts');
  const retry=src.slice(src.indexOf('handleRetryPersonalInitialization:'),src.indexOf('type AuthenticationLifecycleDependencies'));
  assert.match(retry,/personalInitialization\.run\(`retry/);
  assert.doesNotMatch(retry,/disconnectDigestSession\(|setAuthSession\(null\)|resetMaestroKinds\(/);
  const lifecycle=src.slice(src.indexOf('export function useAuthenticationSessionLifecycle'));
  assert.match(lifecycle,/controller\.stop\(\)/);
  assert.doesNotMatch(lifecycle,/unsubscribe\(\);controller\.stop\(\);disconnectDigestSession\(\)/);
});

test('the invoking XState actor completes seed, bootstrap and four policy targets before readiness',()=>{
  const src=read('src/canvas/controllers/authentication.ts');
  assert.ok(src.indexOf('await seedPersonalGraphs(')<src.indexOf('await refreshAuthBootstrap('));
  assert.ok(src.indexOf('invalidateClientStatusMachines();')<src.indexOf('await loadClientStatusMachines('));
  assert.ok(src.indexOf('await loadClientStatusMachines(')<src.indexOf('deps.setPersonalPoliciesReady(true)')); 
  for(const target of ['Resource','Provider','ClassPolicy','CurationProvider']) assert.match(src,new RegExp(target));
  const access=read('src/canvas/diagnostics/use-maestro-access.ts');
  assert.doesNotMatch(access,/loadClientStatusMachines\(/);
  assert.match(access,/initializationSnapshot\.context/);
  assert.match(read('src/lib/app-lifecycle/personal-initialization-machine.ts'),/fromPromise\(/);
  assert.ok(!fs.existsSync('src/lib/personal-initialization.ts'));
});

test('React observations are post-commit and cancellation still remains explicit',()=>{
  const src=read('src/canvas/diagnostics/use-maestro-operations.ts');
  assert.match(src,/useEffect\(\(\) => \{\s*controller\.send\(\{ type: "GRAPH_OBSERVED"/);
  assert.match(src,/useLayoutEffect\(\(\) => \{\s*controller\.start\(\)/);
  assert.match(read('src/canvas/utils/workspace-controller.tsx'),/operations\.controller\.send\(\{ type: "GLOBAL_CANCEL" \}\)/);
});

test('new TypeScript modules parse',()=>{
  for(const path of ['src/lib/app-lifecycle/personal-initialization-machine.ts','src/canvas/controllers/authentication.ts',
    'src/canvas/diagnostics/use-maestro-access.ts','src/lib/app-lifecycle/access.ts','src/canvas/utils/workspace-controller.tsx',
    'src/canvas/top/appbar-pane.tsx']){
    const code=read(path);const ast=ts.createSourceFile(path,code,ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(ast.parseDiagnostics.length,0,`${path}: ${ast.parseDiagnostics.map(x=>x.messageText).join(', ')}`);
  }
});
