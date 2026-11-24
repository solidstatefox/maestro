const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
function loadTs(rel,mocks={}) {
  const js=ts.transpileModule(read(rel),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',js)((id)=>{if(id in mocks)return mocks[id];throw Error(`Unmocked ${id} in ${rel}`)},module,module.exports);
  return module.exports;
}

test('actual mui:RecordViewerWidget stylesheet is identical to the tested standalone Project formatter',()=>{
  const ttl=read('graph/eu-data/provider.ttl');
  const stylesheet=read('graph/eu-data/record.xsl');
  const templates=[...ttl.matchAll(/mui:templateContent """([\s\S]*?)"""/g)];
  assert.equal(templates.length,3);
  assert.equal(templates[0][1],read('graph/eu-data/perspective.xsl'));
  for (const index of [1]) {
    // Turtle long-string escapes one additional slash per XSLT regex escape.
    assert.equal(templates[index][1].replace(/\\\\/g,'\\'),stylesheet,`embedded stylesheet ${index} differs`);
  }
  assert.match(ttl, /widget#Record> a mui:RecordViewerWidget/);
  assert.match(stylesheet,/name="acronymRaw"[^>]*@label/);
  assert.match(stylesheet,/id="eu-project-class-meta"/);
  assert.match(stylesheet,/id="eu-project-acronym"/);
  assert.match(stylesheet,/id="eu-project-status-icon"/);
  assert.match(stylesheet,/name="project-involved-party"[\s\S]*?\$term\/@label/);
  assert.match(stylesheet,/name="project-party-display"/);
  assert.match(stylesheet,/concat\(\$eu,'hasAcronym'\)/);
  assert.match(stylesheet,/concat\(\$eu,'projectStatus'\)/);
  assert.match(stylesheet,/id="eu-project-results-list"/);
  assert.match(stylesheet,/id="eu-project-details"/);
});

test('ongoing Projects distinguish elapsed time from muted remaining duration, with an independent duration pin',()=>{
  const stylesheet=read('graph/eu-data/record.xsl');
  assert.match(stylesheet,/name="isOngoing"[^>]+not\(\$statusCode = 'CLOSED' or \$isTerminated\)/);
  assert.match(stylesheet,/name="todayPosition"[^>]+\$validDates/);
  assert.match(stylesheet,/name="elapsedDurationPosition"[^>]+min\(\(\$durationPosition,\$todayPosition\)\)/);
  assert.match(stylesheet,/name="remainingDurationPosition"[^>]+\$durationPosition - \$elapsedDurationPosition/);
  assert.match(stylesheet,/id="eu-project-track-fill"[^>]+\$elapsedDurationPosition/);
  assert.match(stylesheet,/id="eu-project-track-remaining"[^>]+\$remainingDurationPosition/);
  assert.match(stylesheet,/id="eu-project-duration-marker"[^>]+\$durationPosition/);
  assert.match(stylesheet,/id="eu-project-today-marker"/);
  assert.match(stylesheet,/fmt:months\(string\(\$durationRow\/fct:column\[3\]\)\)/);
});

test('FCT serializer removes XML-illegal control characters while preserving RDF markup and astral Unicode',()=>{
  const route=read('src/app/proxy/api/fct/route.ts');
  const functionSource=route.match(/function xmlText\(value: unknown\): string \{[\s\S]*?\n\}/);
  assert.ok(functionSource,'missing route escape function');
  const js=ts.transpileModule(`${functionSource[0]}\nmodule.exports = xmlText;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};new Function('module',js)(module);
  const escape=module.exports;
  const raw='migrants\u0019 human rights & <data> 👩🏽‍🔬 \uD800';
  const sanitized=escape(raw);
  assert.equal(sanitized,'migrants\uFFFD human rights &amp; &lt;data&gt; 👩🏽‍🔬 \uFFFD');
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(sanitized));
  assert.equal(escape('line1\nline2\tend'), 'line1\nline2\tend');
});

test('EURIO derived fields use approved provider-declared RDF label input',()=>{
  const rdf=read('graph/eu-data/involved-party-derived.ttl');
  assert.match(rdf,/mui:sourceValuePredicate rdfs:label/);
  assert.match(rdf,/sh:property \[ sh:path eurio:hasInvolvedParty \]/);
  const discovery=read('src/lib/client-derived-facet-providers.ts');
  assert.match(discovery,/OPTIONAL \{ \?provider mui:sourceValuePredicate \?sourceValuePredicate \}/);
  const identity=loadTs('src/lib/fct-node-identity.ts');
  const spawn=loadTs('src/lib/fct-derived-facets.ts',{'./fct-node-identity':identity}).spawnRegexDerivedFacets;
  const source={id:'b',name:'property',attributes:{iri:'http://data.europa.eu/s66#hasInvolvedParty',rid:'a'},children:[]};
  const base={name:'query',attributes:{id:'a',ctr:'15',uctr:'a',rctr:'c',addr:'$ALL$@https://cordis.europa.eu/datalab/sparql'},children:[{id:'i',name:'value',attributes:{datatype:'uri'},text:'http://example.org/project',children:[]},source]};
  const field={iri:'gttp://example.org/derived/role',label:'hasInvolvedParty: Role',pattern:'^Org: (.*)/ Role: (.*)/ Project: (.*)$',capture:'2',sourceValuePredicate:'http://www.w3.org/2000/01/rdf-schema#label'};
  const tree=spawn(base,'b',[field]);
  const derived={...tree.children[2],children:[{id:'v',name:'view',attributes:{type:'list',limit:'30',offset:'0'},children:[]}]};
  assert.equal(derived.attributes.sourceValuePredicate,field.sourceValuePredicate);
  assert.equal(derived.attributes.pid,source.attributes.rid);
  assert.equal(spawn(tree,'b',[field]).children.length,3,'repeated extraction must be idempotent');
  const prior={...field,sourceValuePredicate:undefined,pattern:'^old$',label:'old label'};
  const stale=spawn(base,'b',[prior]);
  const refreshed=spawn(stale,'b',[field]);
  assert.equal(refreshed.children.length,3);
  assert.equal(refreshed.children[2].id,stale.children[2].id,'preserve selected facet identity');
  assert.equal(refreshed.children[2].attributes.sourceValuePredicate,field.sourceValuePredicate);
  assert.equal(refreshed.children[2].attributes.pattern,field.pattern);
  const kinds={'./maestro-language':{effectiveMaestroLanguage:()=> 'en',validMaestroLanguage:(x)=>x},'./maestro-kinds':{MAESTRO_KIND_IDS:[],normalizeMaestroKind:()=>null,maestroKindSparql:()=>''},'./fct-value-references':loadTs('src/lib/fct-value-references.ts'),'./graph-address-mode':{ALL_GRAPHS:'$ALL$'},'./fct-value-policy':{normalizeFctValue:s=>s??''},'./virtuoso-full-text':{buildVirtuosoFullTextExpression:()=>null},'./virtuoso-numeric-coercion':{guardedNumericRangeFilter:()=>'',numericFacetBinding:()=>'',NUMERIC_FACET_PROJECTION:''}};
  const count=loadTs('src/lib/fct-count-sparql.ts',kinds).buildFctCountSparql({...base,children:[...base.children,derived]});
  assert.ok(count && count.includes(`<${field.sourceValuePredicate}>`),count);
  assert.match(count,/FILTER \(isLiteral\(\?fct\d+\)\)/);
  assert.match(count,/REGEX\(STR\(\?fct\d+\)/);
  const mocks={
    './maestro-language':kinds['./maestro-language'],
    './maestro-kinds':kinds['./maestro-kinds'],
    './fct-view-types':{FCT_VIEW_TYPES:{TEXT:'text',LIST:'list',LIST_COUNT:'list-count',DESCRIBE:'describe',PROPERTIES:'properties',PROPERTIES_IN:'properties-in',CLASSES:'classes',GRAPHS:'graphs'},isFctViewType:()=>true},
    './bnode':{isBlankNodeTerm:()=>false,bnodeDescribeBounds:()=>({}),RDF_REST_IRI:'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'},
    'fast-xml-parser':{XMLParser:class{parse(){return {query:{'@_addr':base.attributes.addr,value:{'@_datatype':'uri','#text':'http://example.org/project'},property:[{'@_iri':source.attributes.iri,'@_rid':'a'},{'@_iri':field.iri,'@_rid':'b','@_pid':'a','@_derive':'regex','@_pattern':field.pattern,'@_capture':'2','@_sourceValuePredicate':field.sourceValuePredicate,view:{'@_type':'list','@_limit':'30','@_offset':'0'}}]}}}},XMLValidator:{validate:()=>true}},
    './fct-value-references':loadTs('src/lib/fct-value-references.ts'),
    './fct-value-policy':kinds['./fct-value-policy'],
    './virtuoso-numeric-coercion':{NUMERIC_LEXICAL_PATTERN:'^[-+]?\\d+$'},
    './virtuoso-full-text':kinds['./virtuoso-full-text'],
    './graph-address-mode':kinds['./graph-address-mode']
  };
  const compile=loadTs('src/lib/fct-sparql-translator.ts',{...mocks,'./fct-get-path':loadTs('src/lib/fct-get-path.ts')}).compileFctXmlToSparql;
  const sparql=compile('<query/>').query;
  assert.ok(sparql.includes(`<${field.sourceValuePredicate}>`),sparql);
  assert.match(sparql,/isLiteral\(\?s\d+\)/);
  assert.match(sparql,/BIND\(REPLACE\(STR\(\?s\d+\)/);
});

test('EURIO rich values render from DESCRIBE URI labels without extra resource pivots',()=>{
  const xslt=read('graph/eu-data/record.xsl');
  const controller=read('src/canvas/utils/workspace-controller.tsx');
  const queryRoute=read('src/app/proxy/api/sparql/route.ts');
  const derived=read('graph/eu-data/involved-party-derived.ttl');
  assert.match(xslt,/name="project-involved-party"[\s\S]*?\$term\/@label/);
  assert.match(xslt,/name="project-monetary"[\s\S]*?\$term\/@label/);
  assert.match(xslt,/name="acronymRaw"[^>]*\$acronymTerm\/@label/);
  assert.doesNotMatch(xslt,/acronymShortForm|acronymLinkedUri|shortForm/);
  assert.doesNotMatch(queryRoute,/http:\/\/data\.europa\.eu\/s66#shortForm/);
  assert.doesNotMatch(controller,/http:\/\/data\.europa\.eu\/s66#shortForm/);
  assert.match(derived,/mui:sourceValuePredicate rdfs:label/);
  assert.match(controller,/dataset\.maestroPreserveFormattedLabel === "true"/);
  for (const id of ['eu-project-acronym']) assert.match(xslt,new RegExp(`id="${id}"[^>]*data-maestro-preserve-formatted-label="true"`));
  // Result links also preserve their provider-authored title instead of being relabeled by the Record host.
  assert.match(xslt,/id="eu-project-result-link-\{\$n\}"[^>]*data-maestro-preserve-formatted-label="true"/);
  const markers=xslt.match(/data-maestro-preserve-formatted-label="true"/g)||[];
  assert.equal(markers.length,4,'acronym, participants, money and Result links preserve their XSLT markup');
});

test('master timeout slider has inner horizontal padding, not flush border',()=>{
  assert.match(read('src/canvas/sheet/settings-pane.tsx'),/masterTimeoutEnabled && <div className="w-full min-w-0 space-y-2 px-4 py-3"/);
});
