import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureFctQueryIds, isValidFctNodeId, nextFctQueryId, nextLetterLeadingFctCounter } from '../src/lib/fct-node-identity.ts';

const query = (ctr, children = [], root = 'a') => ({
  name: 'query',
  attributes: { id: root, ctr: String(ctr) },
  children,
});

test('base36 node IDs are filtered by their most significant digit, not by remainder', () => {
  for (const [n, expected] of [
    [10, 10], [35, 35], [36, 360], [45, 360], [46, 360],
    [359, 360], [360, 360], [395, 395], [1295, 1295],
    [1296, 12960], [1297, 12960], [12959, 12960], [12960, 12960],
    [46655, 46655], [46656, 466560],
  ]) {
    assert.equal(nextLetterLeadingFctCounter(n), expected, `${n.toString(36)} must skip to ${expected.toString(36)}`);
    assert.match(expected.toString(36), /^[a-z]/);
  }
  for (const id of ['a', 'z', 'a0', 'az', 'zz', 'a00', 'zzz', 'abc']) assert.ok(isValidFctNodeId(id), id);
  for (const id of ['0', '9', '10', '1a', '9z', '100', '3z', '1zz', '', 'A', 'query-view']) assert.equal(isValidFctNodeId(id), false, id);
});

test('query allocator jumps invalid-leading blocks and remains monotonic', () => {
  for (const [start, expectedId, expectedCounter] of [
    [10, 'b', '12'], [35, 'z', '360'], [36, 'a0', '361'],
    [359, 'a0', '361'], [1295, 'zz', '12960'], [1296, 'a00', '12961'],
  ]) {
    // root a is reserved, so ctr=10 allocates b.
    const next = nextFctQueryId(query(start));
    assert.deepEqual(next, { id: expectedId, ctr: expectedCounter });
  }
});

test('legacy numeric-leading XML IDs are replaced without changing valid alphabetic IDs', () => {
  const fixed = ensureFctQueryIds(query(35, [
    { id: '10', name: 'property', attributes: { iri: 'urn:one' }, children: [] },
    { id: 'z', name: 'property', attributes: { iri: 'urn:two' }, children: [] },
    { id: '1a', name: 'view', attributes: { type: 'list' }, children: [] },
  ]));
  const ids = [fixed.attributes.id, ...fixed.children.map(n => n.id)];
  assert.equal(ids[0], 'a');
  assert.equal(ids[2], 'z');
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(isValidFctNodeId), ids.join(','));
  assert.deepEqual([fixed.children[0].uiKey, fixed.children[2].uiKey], ['10', '1a']);
  assert.ok(Number(fixed.attributes.ctr) > 360);
  assert.deepEqual(ensureFctQueryIds(fixed), fixed);
});


test('persisted ctr always advances beyond the highest allocated ID and skips numeric-leading blocks', () => {
  const normalized = ensureFctQueryIds(query(10, [
    {id:'z',name:'property',attributes:{iri:'urn:z'},children:[]},
    {id:'a0',name:'view',attributes:{type:'list'},children:[]},
  ]));
  assert.equal(normalized.attributes.ctr, '361');
  assert.deepEqual(nextFctQueryId(normalized), {id:'a1',ctr:'362'});
  assert.equal(ensureFctQueryIds(normalized).attributes.ctr, '361');
  for (const ctr of [35,36,359,1295,1296,12959,46655,46656]) {
    const advanced = nextFctQueryId(query(ctr));
    assert.ok(isValidFctNodeId(advanced.id), advanced.id);
    assert.equal(Number(advanced.ctr), nextLetterLeadingFctCounter(parseInt(advanced.id,36)+1));
  }
});
