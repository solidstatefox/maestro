import test from "node:test";
import assert from "node:assert/strict";
import { ribbonQuerySource, PROVIDER_QUERY_KINDS } from "../src/lib/ribbon-query-source";
import { buildAnalysisDiscoverySparql, buildViewDiscoverySparql, personalDiscoveryTarget } from "../src/lib/personal-sparql-reads";
import { providerCatalogGraph } from "../src/lib/graph-context";
import { providerFctQuery } from "../src/lib/provider-fct-query";
import { compileFctXmlToSparql } from "../src/lib/fct-sparql-translator";
import { serializeFctQuery, type FctQueryTree } from "../src/lib/fct-query-api";
import type { PersonalAuthSession } from "../src/lib/personal-auth";
const session: PersonalAuthSession = {authType:"sparql-auth",graphStore:"https://personal.example/sparql",graphPrefix:"https://personal.example/home/user",rememberMe:true};
const tree: FctQueryTree = {name:"query",attributes:{addr:"$ALL$@https://browse.example/sparql"},children:[{id:"query-view",name:"view",attributes:{type:"list",limit:"30",offset:"0"},children:[]}]};
const input = {session,tree,endpoints:[{url:session.graphStore}],batchSize:30,providerKind:"policies" as const,analysisClasses:["https://schema.org/EntryPoint"],contextualProviders:null};

test("ribbon query sources use the current personal namespace, not Browse", () => {
  const target = personalDiscoveryTarget(session);
  const view = ribbonQuerySource({...input,format:"perspectives-sparql"});
  assert.equal(view.code,buildViewDiscoverySparql(target.graphs));
  assert.equal(view.addr,`${session.graphPrefix}/query/shacl/policies@https://personal.example/sparql-auth`);
  const analysis = ribbonQuerySource({...input,format:"analysis-sparql"});
  assert.equal(analysis.code,buildAnalysisDiscoverySparql(target.graphs,input.analysisClasses));
  assert.match(analysis.note,/Class-only preview/);
  const providers = ["urn:contextual-provider"];
  assert.equal(ribbonQuerySource({...input,format:"analysis-sparql",contextualProviders:providers}).code,buildAnalysisDiscoverySparql(target.graphs,input.analysisClasses,providers));
  const loggedOut = ribbonQuerySource({...input,format:"perspectives-sparql",session:null});
  assert.equal(loggedOut.addr,undefined);
});

test("all nine Provider catalogs use the real FCT compiler without mutating Browse", () => {
  const before = JSON.stringify(tree);
  for (const {value:providerKind} of PROVIDER_QUERY_KINDS) {
    const {graph,personalEndpointUrl} = providerCatalogGraph(session,providerKind);
    const catalog = providerFctQuery(tree,providerKind,graph,personalEndpointUrl,input.batchSize);
    const source = ribbonQuerySource({...input,format:"providers-sparql",providerKind});
    assert.equal(source.addr,catalog.attributes.addr,providerKind);
    assert.equal(source.code,compileFctXmlToSparql(serializeFctQuery(catalog)).query,providerKind);
    assert.match(source.code,/SELECT/i);
  }
  assert.equal(JSON.stringify(tree),before);
});

 test("Sheet values are shared by the ribbon SELECT builders and Code Block",()=>{
  const limits={perspectives:250,analysis:100};
  const target=personalDiscoveryTarget(session);
  const view=ribbonQuerySource({...input,format:"perspectives-sparql",limits});
  assert.equal(view.code,buildViewDiscoverySparql(target.graphs,250));
  assert.match(view.code,/LIMIT 250$/);
  const analysis=ribbonQuerySource({...input,format:"analysis-sparql",limits});
  assert.equal(analysis.code,buildAnalysisDiscoverySparql(target.graphs,input.analysisClasses,[],100));
  assert.match(analysis.code,/LIMIT 100$/);
});
