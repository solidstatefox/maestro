import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url),'utf8');
test('Root has Base UI Combobox without chevron and popup-specific statuses',()=>{
  const component=read('src/components/ui/combobox.tsx');
  const root=read('src/canvas/top/root-uri-autocomplete.tsx');
  assert.match(component,/from "@base-ui\/react"/);
  assert.match(root,/showTrigger=\{false\}/);
  assert.match(root,/<ComboboxContent[\s\S]*result\.loading[\s\S]*result\.error[\s\S]*No results/);
  assert.match(read('src/lib/uri-autocomplete-query.ts'),/SELECT \?uri \?label \?type/);
  assert.match(read('src/lib/uri-autocomplete-query.ts'),/IRI_RANK/);
  assert.doesNotMatch(read('src/lib/uri-autocomplete-query.ts'),/\\p\{L\}/);
  assert.match(read('src/lib/app-lifecycle/uri-autocomplete.ts'),/ready:/);
});
test('Appbar uses native ButtonGroup and the root signals have a shared seam',()=>{
  const app=read('src/canvas/top/appbar-pane.tsx');
  assert.match(app,/<ButtonGroup className="shrink-0" aria-label="Pinned bookmark shortcuts">/);
  assert.doesNotMatch(app,/inline-flex shrink-0 items-center rounded-md border" aria-label="Pinned bookmark shortcuts"/);
  assert.match(app,/aria-current=\{matchedAppbarButton/);
  assert.match(read('src/components/ui/button-group.tsx'),/data-slot="button-group"/);
  const root=read('src/canvas/top/breadcrumb-renderers.tsx');
  assert.match(root,/<InputGroup/);
  assert.match(root,/BreadcrumbNodeMinus/);
  assert.match(root,/data-maestro-signal-region/);
  assert.doesNotMatch(root,/w-8 items-center justify-center border-l border-input/);
});
test('Clipboard age is checked before root click autofill without assuming arbitrary external timestamp',()=>{
  const recent=read('src/lib/recent-clipboard.ts');
  assert.match(recent,/MAX_AGE_MS=10_000/);
  assert.match(recent,/navigator\.clipboard\.readText/);
  assert.match(read('src/canvas/top/breadcrumb-renderers.tsx'),/void pasteRecentRootClipboard\(\)/);
  const controller=read('src/canvas/utils/workspace-controller.tsx');
  assert.ok(controller.indexOf('} = useAuthenticationState();') < controller.indexOf('if (!authSession) resetMaestroKinds()'), 'kinds reset hook must not reference authSession before initialization');
});
test('Root breadcrumb XState owns the editor and signal lifecycles independently',()=>{
  // Verify the implementation rather than a temporary release-note file.
  // PATCH_NOTES.md is not part of Maestro's required runtime or build inputs.
  const machine=read('src/lib/app-lifecycle/root-breadcrumb.ts');
  const renderer=read('src/canvas/top/breadcrumb-renderers.tsx');
  assert.match(machine,/createMachine\(\{/);
  assert.match(machine,/type: "parallel"/);
  assert.match(machine,/presentation: \{/);
  assert.match(machine,/signal: \{/);
  assert.match(machine,/rootHoverDelay: \(\) => readRootHoverDelayMs\(\)/);
  assert.match(machine,/POINTER_AWAY: \{ target: "leaving"/);
  assert.match(machine,/SIGNAL_SELECTED: "collapsed"/);
  assert.match(renderer,/rootBreadcrumb\.send\(\{ type: "LABEL_ENTER" \}\)/);
  assert.match(renderer,/rootBreadcrumb\.send\(\{ type: "SIGNAL_ENTER" \}\)/);
});
