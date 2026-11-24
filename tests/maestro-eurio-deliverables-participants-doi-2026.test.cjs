const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const xsl=read('graph/eu-data/record.xsl');
const ttl=read('graph/eu-data/provider.ttl');

test('EURIO Project uses Funding and Deliverables without altering banner structure',()=>{
 assert.match(xsl,/name="fmt:property-label"/);
 assert.match(xsl,/\$local='isFundedBy'[^\n]*'Funding'/);
 assert.doesNotMatch(xsl,/>Findings and Results</);
 assert.match(xsl,/>Deliverables<\/h3>/);
 assert.match(xsl,/id="eu-project-status-rail"/);
});

test('participant role mapping includes thirdparty and participant with distinct accessible Lucide glyphs',()=>{
 assert.match(xsl,/contains\(replace\(lower-case\(\$role\),'\[\^a-z\]',''\),'thirdparty'\)/);
 assert.match(xsl,/data-maestro-icon="users-round-collaboration"/);
 assert.match(xsl,/contains\(lower-case\(\$role\),'participant'\)/);
 assert.match(xsl,/data-maestro-icon="users"/);
 assert.match(xsl,/aria-label="Coordinator"/);
 assert.match(xsl,/aria-label="Partner"/);
});

test('Project DOI icon is inside expandable narrative, while Results retain their individual DOI',()=>{
 const narration=xsl.indexOf('id="eu-project-narrative"');
 const abstract=xsl.indexOf('select="$abstractRows"',narration);
 const description=xsl.indexOf('select="$descriptionRows"',narration);
 const longText=xsl.indexOf('select="$additionalLongTextRows"',narration);
 const results=xsl.indexOf('id="eu-project-results-section"',narration);
 assert.ok(narration>=0 && abstract>narration && description>abstract && longText>description && results>longText);
 const narrative=xsl.slice(narration,results);
 assert.match(narrative,/data-maestro-expandable="true"/);
 assert.match(narrative,/<xsl:call-template name="project-doi-inline-icon">/);
 assert.match(xsl,/name="projectDoiRow"/);
 assert.match(xsl,/concat\(\$eu,'doi'\),string\(\$projectDoiRow\/fct:column\[2\]\)/);
 assert.match(xsl,/id="eu-project-doi-inline-link"[^>]*data-maestro-external-link="true"/);
 assert.match(xsl,/id="eu-project-doi-link-\{\$n\}"/);
 // Project inline DOI, Project Results DOI, and the Research Result DOI icons.
 assert.equal((xsl.match(/data-maestro-icon="file-chart-column-increasing"/g)||[]).length,4);
 assert.match(xsl,/id="eu-result-doi-icon"/);
 assert.doesNotMatch(xsl,/id="eu-project-doi-inline"[^>]*class="text-sm"/);
 assert.doesNotMatch(xsl,/id="eu-project-doi-icon-\{\$n\}"[^>]*stroke-width="2"/);
});

test('RDF-embedded Record XSLT matches the standalone stylesheet',()=>{
 const escaped=xsl.replace(/\\/g,'\\\\');
 assert.equal(ttl.split(`mui:templateContent """${escaped}`).length-1,1);
});
