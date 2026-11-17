import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const population = readFileSync(new URL('../src/lib/overview-population.ts', import.meta.url), 'utf8');
const overview = readFileSync(new URL('../src/canvas/tab/view/overview.tsx', import.meta.url), 'utf8');
test('text-search coverage reuses compiled current FCT scope and its indexed predicate binding', () => {
  const fn = population.slice(population.indexOf('export function buildOverviewTextMatchCoverageQueries'));
  assert.match(fn, /compileFctXmlToSparql\(cloneOverviewPopulationQuery\(liveXml, 1\)\)/);
  assert.match(fn, /splitCompiledSelect\(compiled\.query\)/);
  assert.match(fn, /FILTER\(\?txtp1 = \?matchedPredicate\)/);
  assert.match(fn, /COUNT\(DISTINCT \$\{focus\}\)/);
  assert.match(fn, /GROUP BY \?matchedPredicate/);
});
test('text-search coverage does not obtain matching predicates from visible results or a 120-member list', () => {
  const fn = population.slice(population.indexOf('export async function readOverviewTextMatchCoverage'));
  assert.doesNotMatch(fn, /fctRead\(|readOverviewPopulation\(|visibleResultsPage|\.slice\(0,120\)/);
  assert.match(fn, /readOverviewAggregate\(queries\.endpoint,queries\.groupedQuery,signal\)/);
});
test('Overview consumes the typed label coverage response and renders a separate text-match radial', () => {
  assert.match(overview, /readOverviewLabelCoverage\(populationKey,nameProperties,controller\.signal\)/);
  assert.match(overview, /const labelCoverage: OverviewPercent\[\]=currentLabels\?\.result\?\.items\?\?\[\]/);
  assert.match(overview, /readOverviewTextMatchCoverage\(populationKey,nameProperties,controller\.signal\)/);
  assert.match(overview, /title="Name and label evidence"/);
  assert.match(overview, /<LabeledRings items=\{textMatchCoverage\}/);
});
