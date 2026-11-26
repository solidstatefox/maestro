const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('Record XSLT owns the runtime EURIO ontology-specific SPARQL and keeps original RDFa', () => {
  const xsl = read('graph/eu-data/record.xsl');
  assert.match(xsl, /name="maestroPhase"/);
  assert.match(xsl, /name="eurio-runtime-label-queries"/);
  assert.match(xsl, /SELECT DISTINCT \?subject \?predicate \?object/);
  for (const predicate of ['eurio:hasFundingScheme', 'eurio:isRoleOf', 'eurio:hasEuroSciVocClassification', 'xl:literalForm'])
    assert.ok(xsl.includes(predicate), `Missing ontology path ${predicate}`);
  assert.match(xsl, /mctx:enrichment\/fct:row/);
  assert.match(xsl, /data-maestro-record-uri/);
  assert.doesNotMatch(xsl, /\bdocument\s*\(\s*\)/);
});

test('Generic two-pass sandbox performs bounded read-only SPARQL and injects the retrieved RDF rows', () => {
  const xslt = read('src/lib/maestro-xslt.ts');
  const sandbox = read('src/lib/record-xslt-sparql-sandbox.ts');
  assert.match(xslt, /sandboxPhase: "queries"/);
  assert.match(xslt, /executeRecordXsltSandboxQueries/);
  assert.match(xslt, /envelope\.importNode\(enrichment/);
  assert.match(sandbox, /SELECT\\s\+DISTINCT/);
  assert.match(sandbox, /LIMIT\\s\+/);
  assert.match(sandbox, /maestroQueryFetch\("\/proxy\/api\/sparql"/);
  assert.match(sandbox, /x-maestro-debug-source/);
  assert.doesNotMatch(sandbox, /hasFundingScheme|EuroSciVoc|isFundedBy/);
});

test('Graph server CRUD uses authenticated personal SPARQL and declares its RDF server type', () => {
  const source = read('src/lib/client-personal-graph-servers.ts');
  const ontology = read('graph/rdfs/maestro-ui-ontology.ttl');
  assert.match(source, /PersonalGraphServer/);
  assert.match(source, /INSERT DATA \{ GRAPH/);
  assert.match(source, /DELETE WHERE \{ GRAPH/);
  assert.match(source, /selectPersonal\(/);
  assert.match(source, /ensureLoggedInPersonalServer/);
  assert.match(source, /if \(existing\)/);
  assert.match(ontology, /mui:PersonalGraphServer a owl:Class/);
  assert.match(ontology, /rdfs:subClassOf <https:\/\/schema\.org\/EntryPoint>/);
});

test('Graph Server Perspective gates only editors through the existing XState mutation capability', () => {
  const view = read('src/canvas/tab/view/page.tsx');
  const manager = read('src/canvas/tab/view/graph-server-manager.tsx');
  assert.match(view, /selectedViewUri === "gttp:\/\/ggg\.maestro\.ecosys\/shacl\/provider\/entrypoint"/);
  assert.match(view, /canMutate=\{workspace\.accessCapabilities\.canMutatePersonalStore\}/);
  assert.match(manager, /DatabasePlus/);
  assert.match(manager, /Trash2/);
  assert.match(manager, /Personal Servers/);
  assert.match(manager, /<Dialog open=\{dialog && canMutate\}/);
});

test('Login and Show Bookmarks explicitly register the current authenticated graph server', () => {
  const controller = read('src/canvas/utils/workspace-controller.tsx');
  assert.doesNotMatch(controller, /void ensureLoggedInPersonalServer\(\)\.then\(refresh\)/);
  assert.match(controller, /await ensureLoggedInPersonalServer\(\)/);
  assert.match(controller, /const synced = await listPersonalGraphServers\(\)/);
  assert.match(controller, /setManagedEndpoints\(synced\.map\(asEndpointOption\)\)/);
});

test('Both saved-entry perspectives show a calendar above current-page activity rows with four drill levels', () => {
  const view = read('src/canvas/tab/view/personal-perspectives.tsx');
  const heatmap = read('src/canvas/tab/view/perspective-calendar-heatmap.tsx');
  assert.match(view, /<PerspectiveCalendarHeatmap rows=\{partitioned\}/);
  for (const level of ['"year"', '"month"', '"week"', '"day"']) assert.ok(heatmap.includes(level));
  assert.match(require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../src/canvas/tab/view/personal-perspectives.tsx"), "utf8"), /PerspectiveCalendarHeatmap rows=\{partitioned\} queryXml=\{queryXml\}/);
  assert.match(heatmap, /row\.created/);
  assert.match(view, /row\.created\.slice\(0,10\) === calendarDay/);
});

test('Outer Browse Record chrome shows selected label without changing provider-formatted title', () => {
  const record = read('src/canvas/right/pane.tsx');
  assert.match(record, />\{recordHeaderLabel\}<\/button>/);
  assert.match(record, /<RecordExplorer/);
});
