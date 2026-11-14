const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

(async () => {
  const file = path.resolve(__dirname, '../src/canvas/controllers/record-rdfa-decoration.ts');
  const { sameRecordStatement, recordBindingOn } = await import(pathToFileURL(file).href);
  const base = { predicate: 'http://example.org/knows', direction: 'property', termType: 'uri', value: 'urn:Bob' };
  assert(sameRecordStatement(base, { ...base }));
  assert(!sameRecordStatement(base, { ...base, value: 'urn:Charlie' }));
  assert(!sameRecordStatement(base, { ...base, direction: 'property-of' }));
  const literal = { predicate: 'urn:name', direction: 'property', termType: 'literal', value: 'Paris', lang: 'fr' };
  assert(sameRecordStatement(literal, { ...literal, lang: 'FR' }));
  assert(!sameRecordStatement(literal, { ...literal, lang: 'en' }));
  // Minimal Element contract for testing RDFa term extraction without a DOM
  // framework or a mock implementation of the Record viewer itself.
  const attrs = { rel: 'urn:knows', resource: 'urn:Bob' };
  const element = {
    closest() { return this; },
    getAttribute(key) { return attrs[key] ?? null; },
    hasAttribute(key) { return Object.hasOwn(attrs, key); },
  };
  assert.deepEqual(recordBindingOn(element), { predicate: 'urn:knows', direction: 'property', termType: 'uri', value: 'urn:Bob' });
  attrs.rel = 'noopener noreferrer';
  assert.equal(recordBindingOn(element), null, 'ordinary HTML links are not RDFa traversal bindings');
  attrs.rel = 'urn:knows'; attrs.resource = '_:local';
  assert.equal(recordBindingOn(element)?.termType, 'bnode');
  delete attrs.rel; delete attrs.resource;
  attrs.property = 'urn:name'; attrs.content = 'Paris'; attrs.lang = 'fr';
  assert.deepEqual(recordBindingOn(element), { predicate: 'urn:name', direction: 'property', termType: 'literal', value: 'Paris', lang: 'fr' });
  console.log('RDFa source identity: direction, typed literal, IRI, bnode and non-RDFa link rejection passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
