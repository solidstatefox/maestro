import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBoundedReadOnlySparql } from '../src/lib/sparql-read-guard.ts';
import { sparqlEditorUrl } from '../src/lib/fct-execution-address.ts';

// This is the exact shape emitted by Record Kinds preview, including its two
// leading diagnostics. The user can run it manually from the inspector.
const kinds = `# Diagnostic preview only: Record Kinds are classified locally over fetched RDF values.
# This SPARQL is not executed by the Record Kind dropdown.
SELECT DISTINCT ?maestroKind ?maestroKindValue WHERE {
  VALUES ?maestroKind { "web-url" "text" "numeric" "date" "email" "phone" "anynomous" }
  { <http://data.europa.eu/s66/resource/projects/91fe6eac-bdc5-385b-ab51-21f31c6fd068> ?recordPredicate ?maestroKindValue . }
  FILTER (?maestroKind = "numeric" && isLiteral(?maestroKindValue))
}
LIMIT 200`;


test('Record Kinds diagnostic preview is a safe runnable SELECT despite leading comments', () => {
  assert.match(kinds, /^# Diagnostic preview only:/);
  assert.match(kinds, /SELECT DISTINCT \?maestroKind \?maestroKindValue WHERE/);
  assert.match(kinds, /LIMIT 200$/);
  assert.equal(isBoundedReadOnlySparql(kinds, 100_000), true);
});

test('read-only guard still rejects updates or federated SERVICE despite leading comments', () => {
  assert.equal(isBoundedReadOnlySparql('# harmless comment\nDELETE WHERE { ?s ?p ?o }', 10_000), false);
  assert.equal(isBoundedReadOnlySparql('# comment\nSELECT * WHERE { SERVICE <urn:remote> { ?s ?p ?o } } LIMIT 2', 10_000), false);
  assert.equal(isBoundedReadOnlySparql('# comment\nDEFINE sql:log-enable 2 SELECT ?s WHERE { ?s ?p ?o } LIMIT 1', 10_000), false);
  assert.equal(isBoundedReadOnlySparql('# comment\nSELECT ?s WHERE { ?s ?p ?o } LIMIT 1', 10), false);
});

test('Code Block endpoint editor strips $ALL$ from default graph while keeping actual graph IRIs', () => {
  const endpoint = 'https://cordis.europa.eu/datalab/sparql';
  const all = new URL(sparqlEditorUrl(`$ALL$@${endpoint}`, kinds));
  assert.equal(all.origin, 'https://cordis.europa.eu');
  assert.equal(all.searchParams.has('default-graph-uri'), false);
  assert.equal(all.searchParams.get('qtxt'), kinds);
  const named = new URL(sparqlEditorUrl(`http://example.net/dataset@${endpoint}`, kinds));
  assert.equal(named.searchParams.get('default-graph-uri'), 'http://example.net/dataset');
});

test('query inspector in-modal action is labeled Execute Query, without changing editor button', () => {
  const source = readFileSync(new URL('../src/canvas/utils/query-inspector.tsx', import.meta.url), 'utf8');
  assert.match(source, /execution\.loading \? "Executing…" : "Execute Query"/);
  assert.match(source, /addr: displayedExecutionAddr/);
});
