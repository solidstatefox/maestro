import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {readdirSync} from 'node:fs';
import {makeOverviewBoundedConnectionQuery,readOverviewBoundedConnectionPaths,readOverviewConnectionPaths,findOverviewConnections} from '../src/lib/overview-connection-path.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const S='http://example.test/escape',T='http://example.test/focus',V='http://example.test/vehicle',P='http://example.test/type';
const q={source:S,target:T,endpoint:'https://example.test/sparql',maxHops:3};
const bind=value=>({value:String(value)});
test('Bounded connection queries contain bound endpoints and all four two-hop orientations',()=>{
  const query=makeOverviewBoundedConnectionQuery({...q,graph:'http://example.test/g'});
  assert.match(query,/SELECT DISTINCT \?via \?p1 \?p2/);
  assert.match(query,/GRAPH <http:\/\/example\.test\/g>/);
  assert.match(query,/FILTER\(isIRI\(\?via\)/);
  assert.match(query,/BIND\("reverse" AS \?d1\)/);
  assert.match(query,/BIND\("reverse" AS \?d2\)/);
  assert.doesNotMatch(query,/INSERT|DELETE|CLEAR GRAPH/);
});
test('Bounded response reconstructs source, actual common neighbor, and target without invention',()=>{
  const rows=[{via:bind(V),p1:bind(P),p2:bind(P),d1:bind('forward'),d2:bind('reverse'),hops:bind(2)}];
  const result=readOverviewBoundedConnectionPaths({results:{bindings:rows}},S,T);
  assert.equal(result.length,1);
  assert.deepEqual(result[0].nodes.map(n=>n.uri),[S,V,T]);
  assert.deepEqual(result[0].edges.map(e=>e.direction),['forward','reverse']);
  assert.deepEqual(readOverviewConnectionPaths({results:{bindings:[{link:bind(V),path:bind('1'),step:bind(1)},{link:bind(T),path:bind('1'),step:bind(2)}]}},S,T),[]);
});
test('Incomplete SPARQL result is an error, not a false no-path conclusion',async()=>{
  const prior=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({incomplete:true,results:{bindings:[]}});
  try{await assert.rejects(findOverviewConnections(q,new AbortController().signal),/incomplete connection search/);}finally{globalThis.fetch=prior;}
});
test('Verified direct RDF link stops after first bound query',async()=>{
  const prior=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({results:{bindings:[{p1:bind(P),d1:bind('forward'),hops:bind(1)}]}})};
  try{const paths=await findOverviewConnections(q,new AbortController().signal);assert.equal(paths.length,1);assert.equal(paths[0].edges[0].predicate,P);assert.equal(calls,1);}finally{globalThis.fetch=prior;}
});
test('TEXT match predicates are projected and parsed without a second item query',()=>{
  const translator=read('src/lib/fct-sparql-translator.ts');
  const parsed=read('src/canvas/utils/fct-response.ts');
  const card=read('src/canvas/tab/browse/results-view.tsx');
  assert.match(translator,/variable\("txtp1"\).*variable\("matchPredicate"\)/);
  assert.match(parsed,/matchPredicate/);
  assert.match(card,/match\.predicate/);
  assert.match(card,/event\.shiftKey/);
});
test('Root-only text-match radial and 0-percent omission; two named radials, no side legend',()=>{
  const overview=read('src/canvas/tab/view/overview.tsx');
  assert.match(overview,/const showTextMatch=rootTextSearch && rootView/);
  assert.match(overview,/items\.filter\(item=>item\.denominator>0 && item\.count>0 && item\.percentage>0\)/);
  assert.equal((overview.match(/<LabeledRings items=/g)||[]).length,2);
  assert.doesNotMatch(overview,/Legend|legend\s*=/);
});
test('Kinds are externalized in a seeded provider, and selections restore from view and persistence',()=>{
  // Kinds are RDF-declared; no obsolete JSON provider registry.
  assert.equal(existsSync(new URL('../graph/kinds/provider.json',import.meta.url)),false);
  const provider=read('graph/kinds/provider.ttl');
  assert.match(provider,/a mui:Provider/);
  const manifest=JSON.parse(read('graph/manifest.json'));
  assert.ok(manifest['kinds/provider.ttl']);
  const compiled=read('src/lib/fct-sparql-translator.ts');
  assert.match(compiled,/bindFctFilterExpression/);
  assert.doesNotMatch(compiled,/from "\.\/maestro-kinds"/);
  const session=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(session,/"kind-property"|`kind-\$\{direction\}`/);
  assert.match(session,/"kind",normalized===/);
  assert.match(session,/window\.localStorage\.setItem\(`maestro:kind:/);
  // RDF provider is seeded directly; the removed JSON generator is not required.
});
test('Mindmap two-URI FCT and virtual Record use FCT population, no synthetic resource',()=>{
  assert.match(read('src/lib/overview-resource-query.ts'),/name:"value"/);
  assert.match(read('src/lib/fct-sparql-translator.ts'),/multipleRootMembers/);
  assert.match(read('src/lib/fct-count-sparql.ts'),/multipleRootMembers/);
  assert.match(read('src/canvas/tab/view/overview-connection-finder.tsx'),/Browse both input resources \(FCT\)/);
  assert.doesNotMatch(read('src/canvas/right/pane.tsx'),/VirtualCommonRecord/);
  assert.match(read('src/canvas/utils/workspace-controller.tsx'),/setDescribedRecord\(sharedRows\)/);
  assert.match(read('src/lib/overview-common-properties.ts'),/HAVING \(COUNT\(DISTINCT/);
});
test('API transport remains consolidated and connection requests are XState-cancellable',()=>{
  const routes=readdirSync(new URL('../src/app/proxy/api/',import.meta.url),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(e=>e.name).sort();
  assert.deepEqual(routes,['fct','service','sparql']);
  const service=read('src/app/proxy/api/service/route.ts');
  assert.match(service,/resolveOpenApiOperation/);
  assert.doesNotMatch(service,/dispatchMaestroService/);
  assert.match(read('src/lib/app-lifecycle/overview-connections.ts'),/fromPromise/);
  assert.match(read('src/lib/app-lifecycle/overview-connections.ts'),/signal:AbortSignal/);
});
