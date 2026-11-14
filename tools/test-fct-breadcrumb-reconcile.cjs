const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const file = pathToFileURL(path.resolve(__dirname, '../src/lib/fct-breadcrumb-reconcile.ts')).href;
const p = (id, iri, children = [], name = 'property') => ({ id, name, attributes: { iri }, children });
const tree = (...nodes) => ({ name:'query', attributes:{ ctr:'10' }, children: [
  { id:'query-view', name:'view', attributes:{type:'list'},children:[] }, ...nodes,
] });
const crumb = (node) => ({ id:node.id, uri:node.attributes.iri, name:node.name });

(async () => {
  const { reconcileFctBreadcrumbTrail: reconcile } = await import(file);
  const oldA = p('a','urn:old:A',[p('b','urn:old:B')]);
  const nextA = p('a','urn:new:A',[p('b','urn:new:B')]);
  const initial = reconcile(tree(oldA), [], [], new Map(), false);
  const stale = reconcile(tree(nextA), [], [crumb(oldA), crumb(oldA.children[0])], initial.scopeSignatures, false);
  assert.deepEqual(stale.trail, [crumb(nextA)], 'replacement must drop old crumbs despite reused node IDs');
  const oldDirection = p('a','urn:same',[], 'property');
  const newDirection = p('a','urn:same',[], 'property-of');
  const direction = reconcile(tree(newDirection), [], [crumb(oldDirection)], reconcile(tree(oldDirection),[],[],new Map(),false).scopeSignatures, false);
  assert.deepEqual(direction.trail,[crumb(newDirection)], 'direction changed while ID and IRI stayed the same');

  const oldNested = p('a','urn:A',[p('b','urn:B')]);
  const moved = p('b','urn:B');
  const reparent = reconcile(tree(p('a','urn:A'), moved), [], [crumb(oldNested), crumb(oldNested.children[0])], new Map(), true);
  assert.deepEqual(reparent.trail, [crumb(oldNested)], 'ghost may not keep a node that moved to another parent');

  const ancestor = reconcile(tree(oldNested), [crumb(oldNested)], [crumb(oldNested), crumb(oldNested.children[0])], new Map(), true);
  assert.deepEqual(ancestor.trail,[crumb(oldNested),crumb(oldNested.children[0])], 'ancestor click keeps the valid ghost suffix');

  const focused = reconcile(tree(oldNested), [crumb(oldNested)], [], new Map(), false);
  assert.deepEqual(focused.trail,[crumb(oldNested),crumb(oldNested.children[0])], 'Configure newly added child appears as ghost');

  const wrapped = { id:'class-1', name:'class', attributes:{iri:'urn:Class'}, children:[p('c','urn:wrapped')] };
  const wrappedFocus = reconcile(tree(wrapped), [crumb(wrapped.children[0])], [], new Map(), false);
  assert.deepEqual(wrappedFocus.trail, [crumb(wrapped.children[0])], 'non-relationship wrapper must not break focused breadcrumb scope');

  const cleared = reconcile(tree(), [], [crumb(oldNested)], initial.scopeSignatures, false);
  assert.deepEqual(cleared.trail, [], 'root replacement without any relationship clears the old ghost');
  console.log('FCT breadcrumb reconciliation: query replacement ID reuse, direction, parent scope, ancestor ghost, Configure additions, class-wrapper path, root clearing passed.');
})().catch(err => { console.error(err);process.exitCode=1; });
