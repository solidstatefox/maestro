import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";

const source = (path: string) => readFileSync(path, "utf8");
const provider = source("graph/map/perspective-ui.xsl");
const turtle = source("graph/map/provider.ttl");
const script = provider.match(/<script type="text\/javascript"><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)?.[1] ?? "";

test("MapLibre UI, Color By projection, markers and facet decorations are provider-authored", () => {
  assert.ok(script.length > 5000, "Provider stylesheet must own the full Map script");
  assert.doesNotThrow(() => new Script(script));
  for (const token of ["loadLibrary('maplibre-gl')", "compileQuery(", "executeQuery(", "projectValues(", "transformXml(", "decorateFacets(", "fitBounds("]) {
    assert.ok(provider.includes(token), `Missing provider-owned Map responsibility: ${token}`);
  }
  assert.doesNotMatch(provider, /data-map-legend/, "Color legend should not occupy the right-side pane");
  assert.match(turtle, /mui:accepts <gttp:\/\/ggg\.maestro\.ecosys\/shacl\/provider\/map-input>/);
  assert.match(turtle, /data-maestro-map/);
});

test("Native View rendering uses generic host rather than a Map-specific TSX", () => {
  const view = source("src/canvas/tab/view/perspective-provider-runtime.tsx");
  assert.match(view, /MaestroProviderHost/);
  assert.doesNotMatch(view, /@\/providers\/map/);
  const bridge = source("src/lib/maestro-provider-dom.ts");
  assert.match(bridge, /projectValues:/);
  assert.match(bridge, /getMountSignal:/);
  assert.match(bridge, /transformXml:/);
});

test("Generated facet controls retain explicit active=true/false semantics", () => {
  assert.match(provider, /active="\{\$isColorFacet\}"/);
  const bridge = source("src/lib/facet-decoration-contract.tsx");
  assert.match(bridge, /control\.getAttribute\("active"\) === "true"/);
});
