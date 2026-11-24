const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8').replace(/\r\n/g,'\n');
const xsl=read('graph/eu-data/record.xsl');const result=xsl.match(/<xsl:template name="RecordResult">[\s\S]*?<\/xsl:template>/)[0];
test('EURIO domain result type is the linked subtitle, not the raw RDF classes',()=>{
 const subtitle=result.match(/<p id="eu-result-domain-types"[\s\S]*?<\/p>/)[0];
 assert.match(result,/name="resultTypeRows" select="\$rows\[fct:column\[2\] = concat\(\$eu,'hasResultType'\)\]"/);
 assert.match(subtitle,/select="\$resultTypeRows"/);assert.match(subtitle,/name="project-atom"/);
 assert.doesNotMatch(subtitle,/\$typeRows|\$rdfType/);assert.match(result,/id="eu-result-rdf-class-\{position\(\)\}" class="sr-only"/);
 const banner=result.slice(result.indexOf('id="eu-result-banner"'),result.indexOf('id="eu-result-title-area"'));
 assert.match(banner,/bg-black dark:bg-black/);assert.match(banner,/CORDIS \/ EURIO/);
 for(const name of ['journal','publisher','year'])assert.match(banner,new RegExp('id="eu-result-'+name+'"'));
 assert.doesNotMatch(banner,/eu-result-specific-type|\$typeRows|\$resultTypeRows/);
 assert.ok(result.indexOf('id="eu-result-domain-types"')<result.indexOf('id="eu-result-abstract"'));
});
test('Perspective and Record templates remain distinct; no second embedded Record copy',()=>{
 const templates=[...read('graph/eu-data/provider.ttl').matchAll(/mui:templateContent """([\s\S]*?)"""/g)];
 assert.equal(templates[0][1],read('graph/eu-data/perspective.xsl'));
 assert.equal(templates[1][1].replace(/\\\\/g,'\\'),xsl);
 assert.equal(templates.filter(t=>t[1].replace(/\\\\/g,'\\')===xsl).length,1);
});
