/** Keep root search signals readable in resting, active and editing states.
 * Run: node --test tests/maestro-root-signal-background.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("root signal backgrounds match ordinary breadcrumb action buttons", () => {
  const render = file("src/canvas/top/breadcrumb-renderers.tsx");
  const root = render.slice(render.indexOf("function renderRootBreadcrumb("), render.indexOf("function renderPathBreadcrumb("));
  const signal = root.slice(root.indexOf('data-maestro-signal-region="true"'), root.indexOf("</InputGroupAddon>", root.indexOf('data-maestro-signal-region="true"')));
  // The addon covers the full root height, including any gap above/below its buttons.
  assert.match(signal, /className="h-full gap-0 bg-background px-0"/);
  // Every collapsed and expanded signal gets a solid theme-background surface.
  assert.match(signal, /className="h-9 w-8 rounded-none bg-background text-muted-foreground/);
  assert.match(signal, /hover:bg-accent hover:text-foreground focus-visible:ring-2/);
  assert.match(signal, /aria-pressed:text-foreground/);
  // The other breadcrumb's chevron is the design reference.
  const path = render.slice(render.indexOf("function renderPathBreadcrumb("));
  assert.match(path, /`bg-background \${isInactiveSuffix \? "text-muted-foreground" : "text-foreground"}`/);
  // Do not change the intentionally faint backplate of each signal glyph.
  assert.match(signal, /<Signal strokeWidth=\{2\.5\} className="absolute inset-0 size-4 opacity-30"/);
});
