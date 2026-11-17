import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');

test('graph seeding uses an ES2017-compatible, newline-preserving graph URN expression', () => {
  const source = read('src/lib/client-graph-seed.ts');
  assert.match(source, /urn:maestro:graph:\(\[\\s\\S\]\*\)\$/);
  assert.doesNotMatch(source, /urn:maestro:graph:\(\.\*\)\$\/s/);
  const expression = /^urn:maestro:graph:([\s\S]*)$/;
  assert.equal('urn:maestro:graph:/a\nb'.replace(expression, (_whole, suffix) => 'https://personal.example' + suffix), 'https://personal.example/a\nb');
});

test('OTC SHACL extraction narrows optional SPARQL binding values before use', () => {
  const source = read('src/lib/client-otc-runner.ts');
  assert.match(source, /const classIri=row\.class\?\.value;if\(classIri\)classes\.add\(classIri\)/);
  assert.match(source, /const path=row\.path\?\.value;/);
  assert.match(source, /if\(!path\|\|row\.path\?\.type!=="uri"\)throw new Error/);
  assert.match(source, /const item:Constraint=\{path,minCount,/);
  assert.match(source, /if\(typeof type!=="string"\|\|typeof value!=="string"\)/);
  assert.match(source, /hasValue=\{type,value,/);
});
