import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeConfigureChanges, isCurrentConfigureDraft, canApplyAutoConfigure, canRefreshApprovedProvider, validRecordGraphFamily, validRecordAuthorGraph } from '../src/lib/app-lifecycle/context-guards.ts';
import { buildOverviewReport, OVERVIEW_PERSPECTIVE_URI } from '../src/lib/overview-metrics.ts';

test('draft selections cannot leak into another view carrier or root query', () => {
  const draft = { scope: 'fish/sense', changes: { 'property:ontolex:sense': true, 'property:skos:definition': true } };
  assert.deepEqual(activeConfigureChanges(draft, 'fish/sense'), draft.changes);
  assert.deepEqual(activeConfigureChanges(draft, 'fish/sense/definition'), {});
  assert.deepEqual(activeConfigureChanges(draft, 'different query'), {});
  assert.equal(isCurrentConfigureDraft(draft, 'fish/sense/definition'), false);
  assert.equal(isCurrentConfigureDraft(draft, 'fish/sense'), true);
});
test('auto-configure rejects stale candidates or incomplete independent fetches', () => {
  const args = { scope:'A', propertySource:'A', roleSource:'A', ready:true, propertiesLoading:false, rolesLoading:false };
  assert.equal(canApplyAutoConfigure(args), true);
  assert.equal(canApplyAutoConfigure({...args, scope:'B'}), false);
  assert.equal(canApplyAutoConfigure({...args, roleSource:'B'}), false);
  assert.equal(canApplyAutoConfigure({...args, propertiesLoading:true}), false);
  assert.equal(canApplyAutoConfigure({...args, ready:false}), false);
});
test('late Providers approval cannot refresh a different active provider or query', () => {
  const active={query:'<query id="a"/>',panel:'providers',providerKind:'curators',tab:'view'};
  assert.equal(canRefreshApprovedProvider(active,'<query id="a"/>','curators'),true);
  assert.equal(canRefreshApprovedProvider({...active,query:'<query id="b"/>'},active.query,'curators'),false);
  assert.equal(canRefreshApprovedProvider({...active,panel:'perspectives'},active.query,'curators'),false);
  assert.equal(canRefreshApprovedProvider({...active,providerKind:'formats'},active.query,'curators'),false);
});
test('Record refresh preserves valid graph/author but drops missing source selections', () => {
  const graphs=['https://example.org/g#one','https://example.org/g#two'];
  assert.ok(validRecordGraphFamily('https://example.org/g',graphs));
  assert.ok(!validRecordGraphFamily('https://example.org/gone',graphs));
  assert.ok(validRecordAuthorGraph('https://example.org/g#one',[{graph:graphs[0]}]));
  assert.ok(!validRecordAuthorGraph('https://example.org/g#two',[{graph:graphs[0]}]));
});
test('overview reports arbitrary FCT results without projecting sample counts to full set', () => {
  const report=buildOverviewReport({total:1200,classes:[{uri:'http://example.org#Noun',label:'Noun',count:100}],
   properties:[{uri:'http://example.org#definition',label:'definition',count:80}],roles:[],graphs:[],
   records:[{uri:'http://example.org/fish', title:'fish', termType:'uri',scopeValues:[
    {property:'http://example.org#definition',label:'definition',direction:'forward',values:[{value:'aquatic animal',lang:'en'}]},
    {property:'http://example.org#year',label:'year',direction:'forward',values:[{value:'2004',datatype:'http://www.w3.org/2001/XMLSchema#gYear'}]},
    {property:'http://example.org#count',label:'count',direction:'forward',values:[{value:'7',datatype:'http://www.w3.org/2001/XMLSchema#integer'}]},
   ]}]});
  assert.equal(OVERVIEW_PERSPECTIVE_URI,'urn:maestro:perspective:overview');
  assert.match(report.summary,/1,200 resources/);
  assert.match(report.summary,/1 loaded result/);
  assert.equal(report.topClasses[0].name,'Noun');
  assert.equal(report.sampleWithDescriptions,1);
  assert.equal(report.topLanguages[0].name,'en');
  assert.deepEqual(report.byDecade,[{name:'2000s',value:1}]);
  assert.equal(report.numericProperties[0].median,7);
});
test('empty dataset and unknown total do not invent results', () => {
 const empty = buildOverviewReport({total:0,classes:[],properties:[],roles:[],graphs:[],records:[]});
 assert.match(empty.summary,/no matching resources/);assert.deepEqual(empty.topClasses,[]);
 const unknown=buildOverviewReport({total:null,classes:[],properties:[],roles:[],graphs:[],records:[]});
 assert.match(unknown.summary,/unknown number/);
});
