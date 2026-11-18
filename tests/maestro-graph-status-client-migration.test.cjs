const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = process.env.MAESTRO_SOURCE_ROOT || path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const MUI = 'gttp://ggg.maestro.ecosys/ns/ui#';
function loadClientStatusReads(select) {
  const source = read('lib/client-status-reads.ts');
  const js = ts.transpileModule(source, { fileName:'client-status-reads.ts', compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const target = { exports: {} };
  const modules = {
    '@/lib/client-personal-sparql': {
      personalContext: async () => ({base:'https://test.example/query',addr:'https://test.example/query@https://test.example/sparql'}),
      selectPersonal: select,
    },
    '@/lib/status-machine-client': {loadClientStatusMachines: async () => [{targetClasses:new Set(['http://www.w3.org/2000/01/rdf-schema#Resource'])}]},
    '@/lib/status-machine-runtime': {
      STATUS_RDFS:'http://www.w3.org/2000/01/rdf-schema#',
      machineForTarget: () => ({}),
      effectiveStatus: (_m, assertions) => ({[`${MUI}ReadStatus`]: assertions.includes(`${MUI}Seen`) ? `${MUI}Seen` : `${MUI}Unseen`}),
    },
    '@/lib/personal-status-vocabulary': {
      MUI_NS: MUI, MUI_STATUS:`${MUI}status`, MUI_LAST_LOCATED_AT:`${MUI}lastLocatedAt`,
      MUI_HIDDEN:`${MUI}Hidden`, RECORD_STATUSES: {Seen:`${MUI}Seen`,Unseen:`${MUI}Unseen`,Starred:`${MUI}Starred`},
    },
  };
  new Function('require','module','exports',js)((id) => {if(!modules[id])throw new Error(`Unexpected dependency ${id}`);return modules[id];},target,target.exports);
  return target.exports;
}
test('Graph field uses one shared edit state for input and discovery gate', () => {
  assert.match(read('canvas/top/appbar-pane.tsx'), /graphFieldEditing: graphAddressEditing/);
  assert.match(read('canvas/utils/workspace-controller.tsx'), /graphAlreadySelected \|\| graphFieldEditing \|\| !graphAutoFill/);
  assert.match(read('canvas/top/appbar-pane.tsx'), /placeholder="Enter graph URI"/);
  assert.match(read('canvas/top/appbar-pane.tsx'), />Everywhere<\/span>/);
});
test('Auto-fill remains off until explicit click or initial URL restore', () => {
  assert.match(read('canvas/left/filter.tsx'), /graphAutoFill, setGraphAutoFill\] = useState\(false\)/);
  assert.match(read('canvas/utils/workspace-controller.tsx'), /if \(restoreAutoFillPreference && typeof restored\.graphAutoFill === "boolean"\)/);
  assert.match(read('canvas/utils/workspace-controller.tsx'), /params\.get\("history"\), true\)/);
});
test('Record page status uses browser RDF/XState, preserving virtual Unseen', async () => {
  const resources = ['https://example.test/alice','https://example.test/bob'];
  const read = loadClientStatusReads(async () => [
    {s:{value:resources[0]},status:{value:`${MUI}Seen`}},
    {s:{value:resources[0]},status:{value:`${MUI}Starred`}},
    {s:{value:resources[0]},status:{value:`${MUI}Hidden`}},
    {s:{value:resources[1]}},
  ]);
  const page = await read.readClientRecordPage(resources);
  assert.deepEqual(new Set(page.statuses[resources[0]]),new Set(['Seen','Starred']));
  assert.deepEqual(page.statuses[resources[1]],['Unseen']);
  assert.deepEqual(page.hidden,[resources[0]]);
  await assert.rejects(read.readClientRecordPage(['not an IRI']),/Invalid Record status page/);
});
test('Query-hash Status facets count only materialized assertions', async () => {
  const read = loadClientStatusReads(async (sparql) => {
    assert.match(sparql,/query\/status\/sha256:[0-9a-f]{64}/);
    let count = 0;
    if (sparql.includes(`<${MUI}Unseen>`)) count=2;
    if (sparql.includes(`<${MUI}Seen>`)) count=3;
    if (sparql.includes(`<${MUI}Starred>`)) count=4;
    if (sparql.includes(`<${MUI}Hidden>`)) count=1;
    return [{ct:{value:String(count)}}];
  });
  const counts = await read.readClientStatusFacetCounts(`sha256:${'a'.repeat(64)}`);
  assert.deepEqual(counts.counts,{New:2,Unseen:2,Seen:3,Starred:4,Hidden:1});
  assert.equal(counts.hasStatuses,true);
  await assert.rejects(read.readClientStatusFacetCounts('invalid'),/bookmarked-query hash/);
});
test('Record status transitions are browser-owned, without server RPC', () => {
  const controller=read('canvas/controllers/personal-record-status.ts');
  const writes=read('lib/client-status-writes.ts');
  const route=read('app/proxy/api/service/route.ts');
  assert.doesNotMatch(controller,/action: "(?:page|facets)"/);
  assert.match(writes,/updatePersonal/);
  assert.doesNotMatch(route,/record-status|dispatchMaestroService/);
});

test('Client XState definitions reuse the canonical personal SPARQL transport', () => {
  const source = read('lib/status-machine-client.ts');
  assert.match(source, /personalContext\(\)/);
  assert.match(source, /selectPersonal\(statusMachineSelect\(graph\), ctx, signal\)/);
  assert.doesNotMatch(source, /fetch\(\"\/proxy\/api\/sparql\"/);
});
