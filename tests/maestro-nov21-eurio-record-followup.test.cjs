'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname,'..');
const file = (p) => fs.readFileSync(path.join(base,p),'utf8');
const xsl = file('graph/eu-data/record.xsl');
const ttl = file('graph/eu-data/provider.ttl');
const pages = file('src/components/ui/record-value-pages.tsx');
const route = file('src/app/proxy/api/sparql/route.ts');
const workspace = file('src/canvas/utils/workspace-controller.tsx');
const pane = file('src/canvas/right/pane.tsx');
const record = file('src/canvas/right/record.tsx');
const sanitizer = file('src/lib/download-filename.ts');
test('Project Results heading, conditional standard pagination', () => {
 assert.match(xsl, /id="eu-project-results-title"[^>]*>Deliverables<\/h3>/);
 assert.match(xsl, /<RecordValuePages[^>]+pageSize="5"[^>]+pageSizeSelect="true"/);
 assert.match(pages, /\{pages > 1 && \(/);
});
test('original duration/date calculation and label are retained, only collision layers changed', () => {
 assert.match(xsl, /name="durationEnd"[\s\S]*?xs:date\(substring\(\$startValue/);
 assert.match(xsl, /name="durationPosition"[\s\S]*?days-from-duration\(\$durationEnd/);
 assert.match(xsl, /id="eu-project-duration-marker"[^>]*class="[^"]*z-30 hover:z-50[^\"]*-translate-x-1\/2/);
 assert.match(xsl, /id="eu-project-duration-value"[^>]*bg-background[^>]*>/);
 assert.match(xsl, /id="eu-project-termination-marker"[^>]*z-20 hover:z-50/);
 assert.match(xsl, /id="eu-project-termination-value"[^>]*bg-background/);
 assert.doesNotMatch(xsl,/Scheduled duration ends|Scheduled duration\}\"/);
});
test('Participant role icons and zero list indent',()=>{
 assert.match(xsl, /id="eu-project-participants-list" class="list-none[^\"]*p-0/);
 assert.match(xsl, /aria-label="Coordinator"/);
 assert.match(xsl, /aria-label="Partner"/);
});
test('linked resource lookup supports EURIO naming and EuroSciVoc SKOS XL two-hop literalForm',()=>{
 assert.match(route,/skos-xl#prefLabel> \?xlLabel/);
 assert.match(route,/skos-xl#literalForm> \?label/);
 assert.match(route,/http:\/\/data\.europa\.eu\/s66#legalName/);
 assert.match(route,/const graphScope = \(variable: string\)/);
 assert.match(workspace,/http:\/\/www\.w3\.org\/2008\/05\/skos-xl#prefLabel/);
 assert.match(xsl,/name="fmt:linked-label"/);
 assert.match(xsl,/name="readable" select="fmt:linked-label\(\$term\)"/);
 assert.match(xsl,/data-maestro-preserve-formatted-label/);
});
test('Browse URI click resets and sets root, while literal/bnode click requires Shift',()=>{
 assert.match(workspace,/const applyRecordAsRootValue = \(uri: string\) => \{/);
 assert.match(workspace,/resetHomeQuery\(\)/);
 assert.match(workspace,/if \(!shiftClick && row\.termType !== "uri"\) return/);
 assert.match(pane,/binding\.termType !== "uri" && !event\.shiftKey/);
 assert.match(pane,/dataset\.maestroRecordShift/);
});
test('exports use Record title and cross-platform sanitized filenames',()=>{
 assert.match(record,/export function recordDownloadTitle/);
 assert.match(record,/sanitizeDownloadFilename\(title \|\|/);
 assert.match(sanitizer,/CON\|PRN\|AUX\|NUL\|COM\[1-9\]\|LPT\[1-9\]/);
 assert.match(sanitizer,/normalize\("NFKC"\)/);
});
test('embedded EURIO Record stylesheet remains identical to standalone',()=>{
 const embedded = `mui:templateContent """${xsl.replace(/\\/g,'\\\\')}"""`;
 assert.equal(ttl.split(embedded).length-1,1);
});
test('literal Record value looks like a link only while Shift-hovered',()=>{
 const css = file('src/app/globals.css');
 assert.match(css,/\[data-maestro-record-shift="true"\] \[data-maestro-shift-only="true"\]:hover/);
 assert.match(pane,/event\.shiftKey/);
});
