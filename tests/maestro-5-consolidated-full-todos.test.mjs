import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = file => readFileSync(new URL(`../${file}`,import.meta.url), 'utf8');

test('Fullscreen pointer and RDFa click resolver navigate the successor Record session', () => {
  const pane=read('src/canvas/right/pane.tsx');
  const explorer=read('src/canvas/right/record-explorer.tsx');
  const rdfa=read('src/canvas/controllers/record-rdfa-decoration.ts');
  assert.match(pane,/intent: "pivot", kind: "value"/);
  assert.match(pane,/resolveFullscreenRecordTarget\(target, rows\)/);
  assert.match(rdfa,/data-maestro-record-interactive/);
  assert.match(explorer,/controller\.focusSession/);
  assert.match(explorer,/controller\.shrink/);
});

test('Fullscreen Wand presents predicate and value in-place with their shared node ID', () => {
  const pane=read('src/canvas/right/pane.tsx');
  const explorer=read('src/canvas/right/record-explorer.tsx');
  const css=read('src/canvas/right/record-source-highlight.css');
  assert.match(explorer,/wandPropertyNodeId\(wandDraft, trail, item\)/);
  assert.doesNotMatch(explorer,/aria-label="Wand query selections"/);
  assert.match(pane,/data-maestro-inline-wand-slot/);
  assert.match(pane,/data-maestro-wand-inline-replaced/);
  assert.match(pane,/inlineWands\.map\(\(\{host,item,displayKind\},index\) => createPortal/);
  assert.match(pane,/<InputGroup key=\{`\$\{sessionIndex\}/);
  assert.match(pane,/displayKind === "value" \? `= /);
  assert.match(pane,/intent:"wand",kind:item\.kind/);
  assert.match(css,/cursor: pointer/);
  assert.match(css,/padding/);
});

test('Categories contains a centered Provider group and a single connected Radial Arc group', () => {
  const categories=read('src/canvas/left/facet-presentation.tsx');
  // TODO 16 intentionally compacts the old control cluster while keeping
  // Provider centered and both label-layout buttons inside one ToggleGroup.
  assert.match(categories,/justify-center gap-1\.5 px-1 pt-0\.5/);
  assert.match(categories,/<InputGroupAddon align="inline-start" className="h-7 shrink-0 border-r bg-muted\/40 px-1\.5 text-muted-foreground">/);
  assert.match(categories,/className="inline-flex h-7 min-w-0 max-w-40/);
  assert.match(categories,/<InputGroupText className="text-xs">Provider<\/InputGroupText>/);
  assert.match(categories,/<ToggleGroup type="single" aria-label="Sunburst label layout"/);
  assert.equal((categories.match(/<ToggleGroupItem unstyled value=/g)||[]).length,2);
  assert.doesNotMatch(categories,/data-facet-label-toggle/);
});

test('Personal Extract action and four visible tray actions inherit the accepted fixes', () => {
  const tray=read('src/components/ui/left-widget-button-tray.tsx');
  const facet=read('src/canvas/left/derived-facet-button.tsx');
  assert.match(tray,/threshold\s*=\s*4|threshold\?:\s*number/);
  assert.match(facet,/discoverApprovedRegexDerivations/);
  assert.match(facet,/when: Boolean\(source && fields.length\)/);
  assert.match(facet,/extract|regex/i);
});

test('Status joins independent ODS and remote reads and shows real remote query provenance', () => {
  const client=read('src/lib/fct-client.ts');
  const widget=read('src/canvas/left/status-widget.tsx');
  assert.match(client,/selectPersonal\(countQuery, ctx, signal, "status-facet-count",\s*"view",\s*\{tab:"shared",ribbon:"query"\}\)/);
  assert.match(client,/compileFctXmlToSparql\(fctQuery/);
  assert.match(client,/cachedFetchFct\("\/proxy\/api\/sparql"/);
  assert.match(client,/fctListStatusClone\(liveXml, sourceAddr\)/);
  assert.match(client,/addr: sourceAddr/);
  assert.match(widget,/inspectorAddr=\{entriesScope === queryXml && executedAddr/);
  assert.match(widget,/SPARQL \(first batch\)/);
});

test('Perspective discovery avoids the unanchored transitive path', () => {
  const source=read('src/lib/client-personal-perspectives.ts');
  assert.match(source,/\?child rdfs:subClassOf \?parent/);
  assert.match(source,/\?target IN/);
  assert.doesNotMatch(source,/\?queryClass rdfs:subClassOf\+ \?target/);
});

test('All SPARQL Code Blocks have explicit execution provenance with no Browse fallback', () => {
  const block=read('src/components/ui/code-block.tsx');
  const inspector=read('src/canvas/utils/query-inspector.tsx');
  const clone=read('src/lib/fct-query-clone.ts');
  assert.doesNotMatch(block,/useFctQuery/);
  assert.match(block,/sparqlEditorUrl\(executionAddr, code\)/);
  assert.match(inspector,/executionAddr=\{displayedExecutionAddr\}/);
  assert.match(clone,/withFctQueryExecutionAddress\(xml: string, executionAddr: string\)/);
  assert.match(clone,/"@_addr": executionAddr/);
});

test('Upstream Status 401 detail and graph-health failure diagnostics are retained', () => {
  const route=read('src/app/proxy/api/fct/route.ts');
  const health=read('src/lib/sparql-health-probe.ts');
  assert.match(route,/Upstream response body:/);
  assert.match(route,/SPARQL submitted by Maestro:/);
  assert.match(health,/errorName|errorMessage|errorCause|failureReason/);
});


test('Personal Widget Cards pane interface exposes the XState readiness capability', () => {
  const contracts=read('src/canvas/controllers/workspace-interfaces.ts');
  const cards=read('src/canvas/left/personal-widget-cards.tsx');
  const narrow=contracts.split('export type PersonalWidgetCardsWorkspace = Pick<WorkspaceController,')[1]?.split('>;')[0];
  assert.ok(narrow, 'Personal Widget Cards contract exists');
  assert.match(narrow, /\| "accessCapabilities"/);
  assert.match(cards, /workspace\.accessCapabilities\.canUsePersonalStore/);
});
