import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/canvas/left/personal-widget-cards.tsx', import.meta.url), 'utf8');

test('temporal facet renders its own calendar navigation without referencing another branch\'s local values', () => {
  const temporalBranch = source.split(') : temporal?.providers.get(widget.uri) ? (')[1]
    ?.split(') : (\n                <>')[0];
  assert.ok(temporalBranch, 'Expected temporal facet branch');
  assert.match(temporalBranch, /<TemporalFacetContent\b/);
  assert.doesNotMatch(temporalBranch, /\borderedValues\b/, 'orderedValues is scoped to the regular facet values IIFE');
  assert.doesNotMatch(temporalBranch, /\bsetPersonalWidgets\b/, 'calendar navigation is owned by TemporalFacetContent');
});

test('normal personal facet paginates its own distinct ordered values', () => {
  assert.match(source, /const orderedValues = distinctFacetValues\(/);
  assert.match(source, /const pageCount = Math\.max\([\s\S]*Math\.ceil\(orderedValues\.length \/ FACET_PAGE_SIZE\)/);
});
