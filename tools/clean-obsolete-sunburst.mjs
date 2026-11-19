/** Idempotent cleanup for retired sources in ZIP-overlaid checkouts.
 * Never delete manifest-driven RDF/XSLT providers or the shared shadcn UI
 * registry; only verified unreachable source paths appear below. */
import { unlinkSync, existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const legacy = resolve(process.cwd(), "src/canvas/left/category-sunburst.tsx");
if (existsSync(legacy)) {
  unlinkSync(legacy);
  process.stdout.write("Removed retired React Sunburst component.\n");
}
const demo = resolve(process.cwd(), "src/components/charts/chart-sunburst-default.tsx");
if (existsSync(demo)) {
  const source = readFileSync(demo, "utf8");
  // Never delete an independently customized user chart.
  if (source.includes('const chartData: SunburstNode') && source.includes('name: "Revenue"')) {
    unlinkSync(demo);
    process.stdout.write("Removed hardcoded Sunburst revenue sample.\n");
  }
}

// ZIP overlays cannot represent deletions. Permanently retire the verified
// unreachable chart-kit and legacy modules after applying a patch to a checkout.
// The source graph was audited from Next route roots, scripts, registered UI
// components, and client imports. None of these paths is in a live import chain.
const obsoleteDirectory = resolve(process.cwd(), "src/components/ui/charts");
if (existsSync(obsoleteDirectory)) {
  // This is the obsolete, standalone installed chart library, not Maestro's
  // RDF/XSLT graph/sunburst* providers or generated shadcn UI registry.
  const sentinel = resolve(obsoleteDirectory, "core/sankey/context.ts");
  if (!existsSync(sentinel)) throw new Error("Unexpected chart-kit directory; refusing automatic deletion. Audit before removing it.");
  rmSync(obsoleteDirectory, { recursive: true, force: true });
  process.stdout.write("Removed unused standalone chart-kit directory.\n");
}
const unreachableModules = [
  "src/canvas/tab/publish/page.tsx",
  "src/canvas/tab/publish/ribbon.tsx",
  "src/components/ai-elements/task.tsx",
  "src/components/otc-workbench.tsx",
  "src/components/path-explorer.tsx",
  "src/lib/app-lifecycle/features.ts",
  "src/lib/appbar-responsive-tabs.ts",
  "src/lib/bookmark-share-url.ts",
  "src/lib/client-ontology-ingest.ts",
  "src/lib/fct-results-sparql.ts",
  "src/lib/feature-catalog.ts",
  "src/lib/feature-fct-query.ts",
  "src/lib/feature-view-xslt.ts",
  "src/lib/graph-server-view-xslt.ts",
  "src/lib/ontology-ingest.ts",
  "src/lib/otc-runtime.ts",
  "src/lib/personal-status-server.ts",
  "src/lib/shacl-provider-matching.ts",
  "src/lib/uri-autocomplete-type.ts",
  "graph/maestro-ui-components.ttl",
  "tools/patch_analysis.py",
  "tools/patch_remaining.py",
];
for (const name of unreachableModules) {
  const full = resolve(process.cwd(), name);
  if (existsSync(full)) {
    unlinkSync(full);
    process.stdout.write(`Removed unused source: ${name}\n`);
  }
}
