import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeOverviewBoundedConnectionQuery,makeOverviewConnectionQuery,rankOverviewConnectionPaths,
  OVERVIEW_CONNECTION_MAX_HOPS,OVERVIEW_CONNECTION_MAX_PATHS} from '../src/lib/overview-connection-path.ts';
const read = name => readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('radial names use the shadcn labeled 250px rings without a custom SVG label or a legend',()=>{
  const ui=read('src/canvas/tab/view/overview.tsx');
  const labeled=ui.slice(ui.indexOf('function LabeledRings'),ui.indexOf('function RankedPercent'));
  assert.match(labeled,/LabelList position="insideStart" dataKey="predicate"/);
  assert.match(labeled,/startAngle=\{-90\} endAngle=\{270\} innerRadius=\{30\} outerRadius=\{110\}/);
  assert.match(labeled,/max-h-\[250px\]/);
  assert.match(labeled,/\.sort\(\(a,b\)=>b\.percentage-a\.percentage/);
  assert.doesNotMatch(labeled,/<text x=|ringShape|<Legend/);
});
test('Kinds provider has an explicit class, stays in default curator, and gets an FCT-backed Providers ribbon entry',()=>{
  assert.match(read('graph/kinds/provider.ttl'),/a mui:Provider, mui:KindProvider/);
  assert.match(read('graph/maestro-curation-providers.ttl'),/shacl\/provider\/kinds/);
  assert.match(read('src/lib/provider-fct-query.ts'),/providerKind === "kinds"[\s\S]*?KindProvider/);
  assert.match(read('src/canvas/tab/view/ribbon.tsx'),/id: "kinds", label: "Kinds", Icon: Regex/);
  assert.match(read('src/lib/provider-catalog-xslt.ts'),/kinds: `\$\{common\}/);
});
test('Mindmap can request ten hops and show ten diverse verified paths, including non-rdf:type predicates',()=>{
  assert.equal(OVERVIEW_CONNECTION_MAX_HOPS,10);
  assert.equal(OVERVIEW_CONNECTION_MAX_PATHS,10);
  const q={source:'https://example.org/escape',target:'https://example.org/focus',endpoint:'https://example.org/sparql',maxHops:10};
  assert.match(makeOverviewConnectionQuery(q),/T_MAX\(10\)/);
  assert.match(makeOverviewBoundedConnectionQuery(q),/ORDER BY \?hops \?generic/);
  const type='http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  const manufacturer='http://dbpedia.org/ontology/manufacturer';
  const path=(id,uri,preds)=>({id,nodes:[{uri:q.source},...preds.slice(0,-1).map((_,i)=>({uri:`https://example.org/${uri}${i}`})),{uri:q.target}],edges:preds.map(predicate=>({from:q.source,to:q.target,predicate,direction:'forward'}))});
  const generic=Array.from({length:10},(_,i)=>path(`type-${i}`,`type${i}`,[type,type]));
  const interesting=path('maker','maker',[manufacturer,manufacturer,manufacturer]);
  const ranked=rankOverviewConnectionPaths([...generic,interesting]);
  assert.equal(ranked.length,10);
  assert.equal(ranked[0].id,'maker');
});
