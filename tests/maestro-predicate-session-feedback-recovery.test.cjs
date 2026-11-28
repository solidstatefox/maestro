const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = path => fs.readFileSync(path, 'utf8');
const checkSyntax = (file) => {
  const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(tree.parseDiagnostics.length, 0, `${file}: ${tree.parseDiagnostics.map(d => d.messageText).join(', ')}`);
};

test('operations observation is post-commit, with controller start still synchronous for gating', () => {
  const hook = source('src/canvas/diagnostics/use-maestro-operations.ts');
  assert.match(hook, /useLayoutEffect\(\(\) => \{\s*controller\.start\(\)/);
  assert.match(hook, /useEffect\(\(\) => \{\s*controller\.send\(\{ type: "GRAPH_OBSERVED"/);
  assert.match(hook, /controller\.send\(\{ type: "QUERY_OBSERVED"/);
  assert.match(hook, /controller\.send\(\{ type: "NAVIGATION_OBSERVED"/);
  assert.match(hook, /useSyncExternalStore\(controller\.subscribe, controller\.getSnapshot, controller\.getSnapshot\)/);
});

test('user card exposes actual failed initialization error and preserves retry', () => {
  const appbar = source('src/canvas/top/appbar-pane.tsx');
  assert.match(appbar, /workspace\.accessCapabilities\.policyStage === "failed" && <div/);
  assert.match(appbar, /workspace\.accessCapabilities\.policyError \|\| "No initialization error details available\."/);
  assert.match(appbar, /onClick=\{\(\) => void handleRetryPersonalInitialization\(\)\}/);
});

test('cancelling an old personal seed attempt does not contaminate another attempt', async () => {
  const sourceCode = ts.transpileModule(source('src/lib/client-graph-seed.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const digest = 'a'.repeat(64), graph = 'https://example.test/graph';
  const ctx = {addr:'https://example.test/sparql', session:{username:'u',graphPrefix:'https://example.test/u'}, base:'https://example.test/base'};
  const a = new AbortController(), b = new AbortController();
  let firstRead;
  const firstStarted = new Promise(resolve => { firstRead = resolve; });
  let reads = 0;
  const imports = {
    '@/lib/constants/graphs': { GRAPH:{},resolveGraph:()=>graph },
    '@/lib/client-personal-sparql': {
      personalContext:async()=>ctx,
      selectPersonal:async (_query, _ctx, signal)=> {
        reads++;
        if (signal === a.signal) {
          firstRead();
          await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('old attempt aborted')),{once:true}));
        }
        signal?.throwIfAborted();
        return [{graph:{type:'uri',value:graph},digest:{type:'literal',value:digest}}];
      },
      updatePersonal:async()=>{throw new Error('No update expected for an unchanged digest');},
    },
    '@/lib/status-machine-client': {invalidateClientStatusMachines:()=>{}},
    '@/lib/bnode':{createBlankNodeLabelAllocator:()=>value=>value},
    '@/lib/personal-status-vocabulary':{MUI_NS:'urn:mui:'},
    '@/lib/personal-auth':{graphForPrefix:()=>ctx.base},
    '@/lib/graph-seed-content-digest':{destinationSeedDigest:()=>digest},
  };
  const module = {exports:{}};
  vm.runInNewContext(sourceCode, {module,exports:module.exports,require:id=>{
    assert.ok(id in imports,`Unexpected import ${id}`);return imports[id];
  },AbortSignal,AbortController,TextEncoder,URL,crypto:require('node:crypto').webcrypto});
  const plan={base:ctx.base,documents:[],desired:new Map([[graph,digest]]),query:'SELECT ?graph ?digest',revision:'r'};
  const old=module.exports.seedPersonalGraphs(a.signal,plan);
  await firstStarted;
  const replacement=module.exports.seedPersonalGraphs(b.signal,plan);
  a.abort();
  await assert.rejects(old,/old attempt aborted/);
  assert.deepEqual(JSON.parse(JSON.stringify(await replacement)),{revision:'r',changedGraphs:[]});
  assert.equal(reads,2,'replacement must perform its own seed-digest read');
});

test('modified TypeScript and TSX sources parse',()=>{
  for(const file of [
    'src/canvas/diagnostics/use-maestro-operations.ts',
    'src/lib/client-graph-seed.ts',
    'src/canvas/top/appbar-pane.tsx',
    'src/lib/fct-sparql-translator.ts',
    'src/lib/predicate-clusters-provider.ts',
  ])checkSyntax(file);
});
