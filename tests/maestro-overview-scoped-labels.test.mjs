import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../src/lib/overview-population.ts',import.meta.url),'utf8');
test('label coverage derives a focus projection from the live FCT query',()=>{
  assert.match(source,/compileFctXmlToSparql\(cloneOverviewPopulationQuery\(liveXml, 1\)\)/);
  assert.match(source,/splitCompiledSelect\(compiled\.query\)/);
  assert.match(source,/COUNT\(DISTINCT \$\{focus\}\)/);
  assert.match(source,/VALUES \?labelPredicate/);
  assert.match(source,/GROUP BY \?labelPredicate/);
});
test('label coverage never samples visible page resources nor loops per predicate',()=>{
  const fn=source.slice(source.indexOf('export async function readOverviewLabelCoverage'));
  assert.doesNotMatch(fn,/readOverviewPopulation|fctRead|\.slice\(0,\s*120\)/);
  assert.match(fn,/readOverviewAggregate\(endpoint,groupedQuery,signal\)/);
  assert.match(fn,/unionCount=safeCount/);
});
