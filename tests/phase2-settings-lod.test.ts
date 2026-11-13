import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("Map legend is removed while provider-authored map canvas and colors remain", () => {
  const xsl = read("graph/map/perspective-ui.xsl");
  assert.match(xsl, /data-map-canvas=/);
  assert.doesNotMatch(xsl, /data-map-legend/);
  assert.match(xsl, /data-map-colorby/);
});

test("two matching shadcn resizable handles are siblings of the three workspace panels", () => {
  const workspace = read("src/canvas/workspace.tsx");
  const right = read("src/canvas/right/pane.tsx");
  const shells = read("src/canvas/workspace-pane-shells.tsx");
  assert.equal(workspace.match(/<ResizableHandle withHandle \/>/g)?.length, 2);
  assert.ok(workspace.indexOf("<ResizableHandle withHandle />") < workspace.indexOf("<CenterCanvasPanel"));
  assert.doesNotMatch(right, /<ResizableHandle/);
  assert.doesNotMatch(shells, /overflow-hidden border-r/);
});

test("Sheet owns group LIMIT and has master controls for LIMIT and timeouts", () => {
  const center = read("src/canvas/center/pane.tsx");
  const sheet = read("src/canvas/sheet/settings-pane.tsx");
  assert.doesNotMatch(center, /results-batch-size/);
  assert.match(sheet, /Set all:/);
  assert.match(sheet, /set-all-limits/);
  assert.match(sheet, /set-all-timeouts/);
  assert.match(sheet, /InputGroup/);
  assert.match(sheet, /disabled=\{masterTimeoutEnabled\}/);
});

test("query src provenance drives the blue Return control through the controller", () => {
  const query = read("src/canvas/utils/query-controller.ts");
  const controller = read("src/canvas/utils/workspace-controller.tsx");
  const header = read("src/canvas/top/appbar-pane.tsx");
  assert.match(query, /querySourceAttribute/);
  assert.match(controller, /previousQuerySnapshotRef/);
  assert.match(header, /CornerDownLeft/);
  assert.match(header, /returnShareUrl/);
});

test("Categories reads one personal ontology graph and deduplicates namespace fetches", () => {
  const importer = read("src/lib/ontology-ingest.ts");
  const ontologyRoute = read("src/app/proxy/api/service/handlers/ontology.ts");
  assert.match(importer, /parseRdfDocument/);
  assert.match(importer, /buildInsertData/);
  assert.match(importer, /updatePersonalSparql/);
  assert.match(importer, /getPersonalOntologyGraph/);
  assert.match(importer, /byNamespace/);
  assert.match(importer, /namespaceOf/);
  assert.match(importer, /getUserGraph/);
  assert.match(importer, /OWL_IMPORTS/);
  assert.match(importer, /RDFS_IS_DEFINED_BY/);
  assert.match(importer, /publicOntologyUrl/);
  assert.match(ontologyRoute, /ingestOntologyDocuments/);
  assert.doesNotMatch(ontologyRoute, /discoveredGraphIri|getOntologyGraph|dereferenceClass|compactMetadata|metadataCache/);
  assert.match(ontologyRoute, /getPersonalOntologyGraph/);
  assert.match(ontologyRoute, /GRAPH \${graphIri}/);
});
