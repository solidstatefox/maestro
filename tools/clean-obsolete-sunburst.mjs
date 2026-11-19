/** Overlay ZIP extraction cannot delete retired files. Remove only the
 * retired React Sunburst renderer and the untouched installed revenue demo.
 * Production Sunbursts are RDF/XSLT providers, not hardcoded chart data. */
import { unlinkSync, existsSync, readFileSync } from "node:fs";
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
