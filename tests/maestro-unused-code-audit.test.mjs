import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const removed = ["src/canvas/tab/publish/page.tsx", "src/canvas/tab/publish/ribbon.tsx", "src/components/ai-elements/task.tsx", "src/components/otc-workbench.tsx", "src/components/path-explorer.tsx", "src/lib/app-lifecycle/features.ts", "src/lib/appbar-responsive-tabs.ts", "src/lib/bookmark-share-url.ts", "src/lib/client-ontology-ingest.ts", "src/lib/fct-results-sparql.ts", "src/lib/feature-catalog.ts", "src/lib/feature-fct-query.ts", "src/lib/feature-view-xslt.ts", "src/lib/graph-server-view-xslt.ts", "src/lib/ontology-ingest.ts", "src/lib/otc-runtime.ts", "src/lib/personal-status-server.ts", "src/lib/shacl-provider-matching.ts", "src/lib/uri-autocomplete-type.ts", "graph/maestro-ui-components.ttl", "tools/patch_analysis.py", "tools/patch_remaining.py"];
test("retired chart kit and unreachable modules do not reenter production", () => {
  assert.equal(existsSync("src/components/ui/charts"), false);
  for (const file of removed) assert.equal(existsSync(file), false, file);
});
test("provider-backed sunbursts and active D3 analysis remain available", () => {
  for (const file of ["graph/sunburst/provider.ttl", "graph/sunburst-chartkit/provider.ttl", "graph/sankey-d3/provider.ttl", "src/canvas/tab/analyze/d3-sankey.tsx", "src/components/generated/maestro-component-registry.tsx"])
    assert.equal(existsSync(file), true, file);
  const providers = JSON.parse(readFileSync("graph/manifest.json", "utf8"));
  for (const name of ["sunburst/provider.ttl", "sunburst-chartkit/provider.ttl", "sankey-d3/provider.ttl"])
    assert.ok(providers[name], name);
});

test("seeded UI component metadata excludes retired React components", () => {
  const rdf = readFileSync("graph/rdfs/maestro-ui-components.ttl", "utf8");
  for (const name of ["canvas-tab-publish-page", "canvas-tab-publish-ribbon", "components-ai-elements-task", "components-otc-workbench", "components-path-explorer"])
    assert.ok(!rdf.includes(`component/${name}>`), name);
});
