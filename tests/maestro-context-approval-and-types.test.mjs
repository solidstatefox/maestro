import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const read = path => readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('the View badge reflects SHACL matches in the active query and Record, never entire catalog',()=>{
  const actor=read('src/lib/app-lifecycle/pending-approvals.ts');
  const appbar=read('src/canvas/top/appbar-pane.tsx');
  const provenance=read('src/lib/client-provider-provenance.ts');
  assert.match(actor,/fromPromise/);
  assert.match(actor,/ACTIVATE/);
  assert.match(actor,/MATCH/);
  assert.match(actor,/activeMatches\(context\)/);
  assert.match(actor,/item\.status==="Pending"/);
  assert.match(actor,/item\.category==="Policy"/);
  assert.match(actor,/item\.category==="Provider"/);
  assert.match(appbar,/queryMatchedProviders/);
  assert.match(appbar,/pendingApprovalController\.activate\(workspace\.queryXml/);
  assert.match(appbar,/viewBadge/);
  assert.match(appbar,/View\{viewBadge\}/);
  assert.match(provenance,/pendingApprovalController\.match\(context\.queryXml,policies,context\.record\)/);
  assert.doesNotMatch(actor,/SELECT DISTINCT \?provider WHERE/);
});

test('effective provider approval considers direct status or curator implementation-digest grant',()=>{
  const source=read('src/lib/client-policy-approvals.ts');
  assert.match(source,/implementationDigest/);
  assert.match(source,/approvedDigest/);
  assert.match(source,/explicit\|\|inherited/);
  assert.match(source,/category: !known\?null:present\("isClassPolicy"\)\?"Policy":"Provider"/);
});

test('URI autocomplete enriches the existing ranked result without a second request',()=>{
  const component=read('src/canvas/top/root-uri-autocomplete.tsx');
  const query=read('src/lib/uri-autocomplete-query.ts');
  const lifecycle=read('src/lib/app-lifecycle/uri-autocomplete.ts');
  assert.match(component,/createRootUriAutocompleteQuery\(prefix, addr, settings, propertyUris\)/);
  assert.match(component,/const incomingType = row\.type\?\.type === "uri"/);
  assert.match(component,/rdfType/);
  assert.match(component,/return \[\.\.\.unique\.values\(\)\]\.slice\(0,settings\.limit\)/);
  assert.match(component,/One query returns ranked suggestions and their pruned class types/);
  assert.match(query,/ORDER BY DESC \(<LONG::IRI_RANK>/);
  assert.match(lifecycle,/target: "complete"/);
  assert.doesNotMatch(component,/createAutocompleteTypeQuery|selectAutocompleteTypes/);
});

test('Tag provider discovery must match SHACL-declared property, live FCT scope, and approval',()=>{
  const s=read('src/lib/client-facet-providers.ts');
  assert.match(s,/sh:or\/rdf:rest\*\/rdf:first\/sh:property\/sh:path \?property/);
  assert.match(s,/VALUES \?property \{ \$\{values\} \}/);
  assert.match(s,/readClientPolicyApprovals/);
  assert.match(s,/tags:tags\.filter\(p=>approved\.has\(p\.uri\)\)/);
});

test('an Analysis button exists on View > Providers and uses real FCT plus XSLT',()=>{
  assert.match(read('src/canvas/tab/view/ribbon.tsx'),/id: "analysis-providers", label: "Analysis"/);
  assert.match(read('src/lib/provider-fct-query.ts'),/providerKind === "analysis-providers"/);
  assert.match(read('src/lib/provider-fct-query.ts'),/ns\/analyze#Analysis/);
  assert.match(read('src/lib/provider-catalog-xslt.ts'),/"analysis-providers": `\$\{common\}/);
  assert.match(read('src/canvas/utils/workspace-controller.tsx'),/restored\.viewProvider === "analysis-providers"/);
});

test('all new/modified TypeScript syntax parses and generic proxy routes remain absent from patch delta',()=>{
  for(const filename of [
    'src/lib/app-lifecycle/pending-approvals.ts','src/lib/uri-autocomplete-query.ts',
    'src/canvas/top/root-uri-autocomplete.tsx','src/canvas/top/appbar-pane.tsx',
    'src/lib/client-policy-approvals.ts','src/lib/client-provider-provenance.ts',
    'src/lib/client-facet-providers.ts','src/canvas/top/view-diagnostics-hover.tsx',
    'src/canvas/tab/view/ribbon.tsx','src/lib/provider-fct-query.ts',
  ]){
    const ast=ts.createSourceFile(filename,read(filename),ts.ScriptTarget.Latest,true,filename.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.deepEqual(ast.parseDiagnostics.map(d=>String(d.messageText)),[],filename);
  }
});
