import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoredCalendarDate, restoredCalendarWeekStart } from '../src/lib/temporal-calendar-restoration';
const text = (path: string) => readFileSync(path, 'utf8');
const calendar = text('src/canvas/left/personal-date-facet.tsx');
const xsl = text('graph/eu-data/record.xsl');
const ttl = text('graph/eu-data/provider.ttl');
const pages = text('src/components/ui/record-value-pages.tsx');
const browse = text('src/canvas/tab/browse/results-view.tsx');
const controller = text('src/canvas/utils/workspace-controller.tsx');
const focus = (from: string, to: string, domain: {min:string,max:string}|null = null) =>
  restoredCalendarDate(from,to,domain,new Date('2026-11-21T00:00:00Z')).toISOString().slice(0,10);

test('calendar restores From first, To if no From, UTC and clamp to actual domain', () => {
 assert.equal(focus('2020-03-12T04:00:00Z','2024-12-19T22:00:00Z'),'2020-03-12');
 assert.equal(focus('','2024-12-19T22:00:00Z'),'2024-12-19');
 assert.equal(focus('',''),'2026-11-21');
 assert.equal(focus('2019-01-10T00:00:00Z','', {min:'2020-02-03',max:'2022-12-31'}),'2020-02-03');
 assert.equal(focus('','2025-09-17', {min:'2020-02-03',max:'2022-12-31'}),'2022-12-31');
 assert.equal(focus('','', {min:'2024-01-10',max:'2024-08-15'}),'2024-08-15');
 assert.equal(focus('2024-02-30','2021-03-01'),'2021-03-01');
 assert.equal(restoredCalendarWeekStart(new Date('2024-07-03T00:00:00Z')).toISOString().slice(0,10),'2024-07-01');
});
test('calendar hydrates after restoring FCT and domain; user navigation is not an effect dependency', () => {
 assert.match(calendar,/restoredCalendarDate\(savedStart, savedEnd\)/);
 assert.match(calendar,/restoredCalendarDate\(savedStart, savedEnd, domain\)/);
 assert.match(calendar,/\[domain\?\.min, domain\?\.max, savedStart, savedEnd, provider\.property\]/);
 assert.match(calendar,/intervalStyle\(iso\(day\), iso\(day\)\)/);
});
test('Project Participants are real list items; termination pin label stays in bounds', () => {
 assert.match(xsl, /<ul id="eu-project-participants-list"/);
 assert.match(xsl, /<li id="eu-project-participant-\{position\(\)\}"/);
 assert.match(xsl, /terminationPinPosition ge 80/);
 assert.match(xsl, /transform: translateX\(\{if \(\$terminationPinPosition ge 80\) then '-100%'/);
 assert.match(xsl, /id="eu-project-termination-value" datetime="\{\$terminationValue\}"/);
});
test('Results retain per-Result DOI only and Maestro native controls', () => {
 assert.match(xsl, /select="\$allDescribeRows\[normalize-space\(string\(fct:column\[1\]\)\) = normalize-space\(\$resultUri\)\]"/);
 assert.match(xsl, /<xsl:if test="\$doiRow and matches\(\$doi,/);
 assert.match(xsl, /id="eu-project-doi-link-\{\$n\}"/);
 assert.match(pages, /variant="outline" size="icon-sm"/);
 assert.match(pages, /Per page/);
 assert.doesNotMatch(browse, /<thead>/);
 assert.match(browse, /className=\{matchIndex \? "border-t border-border" : ""\}/);
 const escaped = `mui:templateContent """${xsl.replace(/\\/g,'\\\\')}"""`;
 assert.equal(ttl.split(escaped).length-1,2);
});

test('Record enrichment does not arbitrarily restrict All graphs to the first DESCRIBE graph', () => {
  const segment = controller.slice(controller.indexOf('const activeGraph = selectedRecordAuthor'),
    controller.indexOf('const originalAddr = enrichmentRoot.getAttribute'));
  assert.doesNotMatch(segment, /recordGraphs\[0\]/);
  assert.match(segment, /selectedRecordAuthor \|\| \(selectedRecordGraph/);
  assert.match(segment, /: ""\)/);
  assert.match(pages, /layout === "groups" \|\| isResultList/);
});
