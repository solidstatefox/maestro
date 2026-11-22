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
  assert.equal(workspace.match(/<ResizableHandle withHandle className="shrink-0" \/>/g)?.length, 2);
  assert.match(workspace, /\(!urlStateInitialized \|\| workspaceTab === "browse"\) && <ResizableHandle/);
  assert.match(workspace, /\(!urlStateInitialized \|\| workspaceTab === "browse"\) && \(\s*skeletons\.record/);
  assert.ok(workspace.indexOf('<ResizableHandle withHandle') < workspace.indexOf('<CenterCanvasPanel'));
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
  assert.match(controller, /operations\.snapshot\.navigation\.returnUrl/);
  assert.match(controller, /const returnShareUrl/);
  assert.match(header, /CornerDownLeft/);
  assert.match(controller, /const returnButtonVisible = operations\.snapshot\.navigation\.returnVisible/);
  assert.match(header, /returnButtonVisible/);
});

test("Categories metadata is read-only, scoped to personal ontology/cache graphs, without implicit RDF import", () => {
  const metadata = read("src/lib/client-ontology-metadata.ts");
  assert.match(metadata, /selectPersonal\(/);
  assert.match(metadata, /const ctx=await personalContext\(\)/);
  assert.match(metadata, /resolveGraph\(GRAPH\.ONTOLOGY_CACHE,\s*ctx\.base\)/);
  assert.match(metadata, /resolveGraph\(GRAPH\.ONTOLOGY,\s*ctx\.base\)/);
  assert.match(metadata, /VALUES \?g/);
  assert.doesNotMatch(metadata, /updatePersonal\(|LOAD <|await fetch\(/);
  assert.ok(!read("src/app/proxy/api/service/route.ts").includes('ingestOntologyDocuments'));
});
