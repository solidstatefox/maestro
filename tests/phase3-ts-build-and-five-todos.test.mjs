import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const record = file('src/canvas/right/record.tsx');
const pivot = file('src/canvas/controllers/record-session-controller.tsx');
const bnode = file('src/lib/bnode/lifecycle.ts');
const numeric = file('src/canvas/left/personal-numeric-facet.tsx');
const status = file('src/canvas/left/status-widget.tsx');
const calendar = file('src/canvas/left/personal-date-facet.tsx');
const cloud = file('src/canvas/left/personal-tag-cloud.tsx');

test('Record graph-author setter is available to Browse and fullscreen pivot workspaces', () => {
  assert.match(record, /\[recordGraphAuthors, setRecordGraphAuthors\] = useState/);
  assert.match(record, /return \{[^;]+recordGraphAuthors, setRecordGraphAuthors, recordGraphOptions/s);
  assert.match(pivot, /own\.setRecordGraphAuthors\(\[\]\)/);
  assert.match(pivot, /own\.setRecordAuthorError\(""\)/);
  assert.match(pivot, /setSelectedRecordAuthor\(previous => authors\.some\(author => author\.graph === previous\)/);
});

test('blank-node lazy actor is checked for null before the LOAD readback', () => {
  assert.match(bnode, /const currentActor = actor;\s*if \(!currentActor\) return false;\s*currentActor\.send/);
  assert.match(bnode, /return currentActor\.getSnapshot\(\)\.matches\("loading"\)/);
});

test('numeric slider retains last same-endpoint domain while scope is refreshing', () => {
  assert.doesNotMatch(numeric, /setLoading\(true\);setDomain\(null\)/);
  assert.match(numeric, /domainKey\.startsWith\(`\$\{tree\.attributes\.addr\}\\u0000`\)/);
  assert.match(numeric, /const refreshing = !domainIsCurrent \|\| loading/);
  assert.match(numeric, /<Slider orientation="vertical" disabled=\{refreshing \|\| Boolean\(error\)\}/);
  assert.match(numeric, /invalid MIN\/MAX domain/);
});

test('Status never shows misleading zero aggregate or zero row badges', () => {
  assert.match(status, /const showCounts = counts !== null && names\.some\(name => \(counts\[name\] \?\? 0\) > 0\)/);
  assert.match(status, /\{showCounts && shortenCount/);
  assert.match(status, /\{showCounts && <span className="shrink-0/);
  assert.match(status, /selected\.has\(name\)/);
});

test('calendar restores authoritative FCT bounds and clamps only on domain changes', () => {
  assert.match(calendar, /const visibleMonth = `\$\{year\}-\$\{String\(month \+ 1\)\.padStart\(2, "0"\)\}`/);
  assert.match(calendar, /restoredCalendarDate\(savedStart, savedEnd, domain\)/);
  assert.match(calendar, /setWeekStart\(restoredCalendarWeekStart\(focus\)\)/);
  assert.match(calendar, /if \(iso\(weekStart\) > domain\.max \|\| end < domain\.min\)/);
});

test('Tag Cloud keys asynchronous co-occurrence by the exact FCT scope on reentry', () => {
  assert.match(cloud, /const cooccurrenceKey = enabled \? projectionXml : ""/);
  assert.match(cloud, /current\.key === cooccurrenceKey\s*\? \{ \.\.\.current, error: "" \}/);
  assert.match(cloud, /cooccurrence\.key === cooccurrenceKey \? cooccurrence\.values : null/);
  assert.match(cloud, /distinctFacetValues\(\[\s*\.\.\.values, \.\.\.\(cooccurring \?\? \[\]\)/);
});
