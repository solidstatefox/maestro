const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function test() {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../src/canvas/controllers/record-session-model.ts')).href;
  const { RecordSessionsController } = await import(moduleUrl);
  const root = { value: 'urn:alice', termType: 'uri', queryXml: '<query/>' };
  const controller = new RecordSessionsController(root);
  const initial = controller.snapshot().sessions[0];
  const literal = { value: 'Paris', termType: 'literal', lang: 'fr', queryXml: '<query/>' };
  const a = controller.appendPivot(literal, { predicate: 'urn:name', direction: 'property', subjectSessionId: initial.id }, 0);
  assert.deepEqual(controller.snapshot().sessions[1].identity, literal);
  const b = controller.appendPivot({ value: 'urn:b', termType: 'uri', queryXml: '<query/>' },
    { predicate: 'urn:role', direction: 'property-of', subjectSessionId: a.id }, 1);
  const c = controller.appendPivot({ value: 'urn:c', termType: 'uri', queryXml: '<query/>' },
    { predicate: 'urn:p', direction: 'property', subjectSessionId: b.id }, 2);
  assert.equal(controller.snapshot().visibleStart, 1);
  assert.deepEqual(controller.followedSource(initial.id), { predicate: 'urn:name',
    direction: 'property', value: 'Paris', termType: 'literal', lang: 'fr' });
  assert.deepEqual(controller.followedSource(a.id), { predicate: 'urn:role',
    direction: 'property-of', value: 'urn:b', termType: 'uri' });
  // Breadcrumb focus never deletes successors, even after moving backward.
  const completeTrail = controller.snapshot().sessions.map(session => session.id);
  controller.focusSession(0);
  assert.equal(controller.followedSource(a.id)?.value, 'urn:b');
  assert.deepEqual(controller.snapshot().sessions.map(session => session.id), completeTrail);
  assert.equal(controller.snapshot().visibleStart, 0);
  controller.focusSession(2);
  assert.deepEqual(controller.snapshot().sessions.map(session => session.id), completeTrail);
  assert.equal(controller.snapshot().visibleStart, 1);
  controller.focusSession(1);
  assert.equal(controller.snapshot().visibleStart, 1);
  assert.equal(controller.snapshot().sessions.length, 4);
  const abort1 = new AbortController();
  const abort2 = new AbortController();
  controller.registerRequest(c.id, abort1);
  controller.registerRequest(initial.id, abort2);
  controller.shrink();
  assert.equal(controller.followedSource(initial.id), null);
  assert.equal(abort1.signal.aborted, true);
  assert.equal(abort2.signal.aborted, false);
  assert.strictEqual(controller.snapshot().sessions[0], initial);
  assert.equal(controller.snapshot().sessions.length, 1);
  assert.equal(controller.snapshot().visibleStart, 0);
  controller.selectBrowseRecord({ value: 'urn:new', termType: 'uri', queryXml: '<query/>' });
  assert.equal(abort2.signal.aborted, true);
  assert.equal(controller.snapshot().sessions[0].identity.value, 'urn:new');
  // A Shift-click from an ancestor, unlike breadcrumb focus, replaces the tail.
  const branch = new RecordSessionsController(root);
  const branchRoot = branch.snapshot().sessions[0];
  const b1 = branch.appendPivot({ value: 'urn:b1', termType: 'uri', queryXml: '<query/>' },
    { subjectSessionId: branchRoot.id, predicate: 'urn:p', direction: 'property' }, 0);
  const b2 = branch.appendPivot({ value: 'urn:b2', termType: 'uri', queryXml: '<query/>' },
    { subjectSessionId: b1.id, predicate: 'urn:q', direction: 'property' }, 1);
  const discarded = new AbortController();
  branch.registerRequest(b2.id, discarded);
  branch.focusSession(0);
  assert.equal(discarded.signal.aborted, false);
  assert.equal(branch.snapshot().sessions.length, 3);
  branch.appendPivot({ value: 'urn:new', termType: 'uri', queryXml: '<query/>' },
    { subjectSessionId: branchRoot.id, predicate: 'urn:r', direction: 'property-of' }, 0);
  assert.equal(discarded.signal.aborted, true);
  assert.deepEqual(branch.snapshot().sessions.map(s => s.identity.value), ['urn:alice', 'urn:new']);
  console.log('Record sessions: persistent ancestors, Shift-click branch replacement, literal identity, cancellation and shrink passed.');
}
test().catch(e => { console.error(e); process.exitCode = 1; });
