/** Deterministic root breadcrumb design contract; no browser/server dependency.
 * Run: node --test tests/maestro-root-breadcrumb-redesign.test.mjs */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

test('the root has exactly one persistent shadcn InputGroup and preserves inherited minus stack-pop',()=>{
  const render=read('src/canvas/top/breadcrumb-renderers.tsx');
  const root=render.slice(render.indexOf('function renderRootBreadcrumb('),render.indexOf('function renderPathBreadcrumb('));
  const editor=read('src/canvas/utils/workspace-controller.tsx');
  assert.equal((root.match(/<InputGroup\b/g)||[]).length,1);
  assert.match(root, /<InputGroup aria-label="Root breadcrumb"/);
  assert.match(root,/rootSearchExpanded \? searchInputGroup/);
  assert.match(root,/rootConstraints\.length > 0 && <BreadcrumbNodeMinus/);
  assert.ok(root.indexOf('searchInputGroup')<root.indexOf('<BreadcrumbNodeMinus'));
  assert.ok(root.indexOf('<BreadcrumbNodeMinus')<root.indexOf('<InputGroupAddon align="inline-end" data-maestro-signal-region'));
  assert.match(root,/deleteNode\(rootConstraints\[rootConstraints\.length - 1\]\.id\)/);
  assert.doesNotMatch(editor,/<InputGroup aria-label="Root search input"/);
  assert.match(read('src/canvas/top/breadcrumb.tsx'), /export function BreadcrumbNodeMinus/);
  assert.match(render,/variant="input"[\s\S]*?popBreadcrumbOrBinding\(crumb\)/);
});

test('ordinary breadcrumb height and example badge anchoring survive the bottom-padding trial',()=>{
  const render=read('src/canvas/top/breadcrumb-renderers.tsx');
  const path=render.slice(render.indexOf('function renderPathBreadcrumb('));
  assert.match(path,/<InputGroup aria-label=\{`Controls for \${breadcrumbLabel}`\}/);
  assert.match(path,/h-10 w-max max-w-full flex-nowrap overflow-hidden/);
  assert.match(render,/^\/\/ const BREADCRUMB_NODE_BOTTOM_PADDING = "pb-1"; \/\/ previous value$/m);
  assert.match(render,/^const BREADCRUMB_NODE_BOTTOM_PADDING = "pb-0";$/m);
  assert.match(path,/breadcrumbClasses\.length \? `\$\{BREADCRUMB_NODE_BOTTOM_PADDING\} pt-3` : "py-0"/);
  assert.match(path,/<InputGroupAddon align="inline-start"[\s\S]*?<OrUidIcon/);
  assert.match(path,/absolute left-\[calc\(100%\+15px\)\] top-full -translate-x-1\/2 pt-1/);
  assert.doesNotMatch(path,/className="ml-5 inline-flex max-w-full pt-1"/);
  assert.match(render,/className="relative flex min-w-0 max-w-full shrink-0 items-center"/);
});

test('input label and signal unfurl use separate XState parallel regions and events',()=>{
  const machine=read('src/lib/app-lifecycle/root-breadcrumb.ts');
  assert.match(machine,/type: "parallel"/);
  assert.match(machine,/presentation: \{/);
  assert.match(machine,/signal: \{/);
  assert.match(machine,/resting:/);
  assert.match(machine,/editing:/);
  assert.match(machine,/collapsed:/);
  assert.match(machine,/unfurled:/);
  const render=read('src/canvas/top/breadcrumb-renderers.tsx');
  assert.match(render,/data-maestro-root-label-region/);
  assert.match(render,/data-maestro-signal-region/);
  assert.match(render,/rootBreadcrumb\.send\(\{ type: "LABEL_ENTER" \}\)/);
  assert.match(render,/rootBreadcrumb\.send\(\{ type: "SIGNAL_ENTER" \}\)/);
  assert.doesNotMatch(render,/RootHoverTrigger/);
});

test('signal icons keep exactly the agreed five-to-one bar meanings',()=>{
  const w=read('src/canvas/utils/workspace-controller.tsx');
  for(const [mode,icon] of [['uri','Signal'],['exact','SignalHigh'],['name','SignalMedium'],['all','SignalLow'],['clear','SignalZero']])
    assert.match(w,new RegExp(`mode: "${mode}" as const, Icon: ${icon}`));
  const render=read('src/canvas/top/breadcrumb-renderers.tsx');
  assert.match(render,/signalPickerExpanded \? signalOptions : signalOptions\.filter\(option => option\.mode === textSearchMode\)/);
});

test('URI suggestions are indexed, proxy-priority-safe, and strictly ranked',()=>{
  const q=read('src/lib/uri-autocomplete-query.ts');
  assert.match(q,/bif:contains/);
  assert.match(q,/FILTER\(LCASE\(STR\(\?matchedLabel\)\) =/);
  assert.match(q,/ORDER BY DESC \(<LONG::IRI_RANK> \(\?uri\)\)/);
  assert.doesNotMatch(q,/ORDER BY LCASE/);
  const c=read('src/canvas/top/root-uri-autocomplete.tsx');
  assert.match(c,/requestClass:"autocomplete"/);
  assert.match(c,/selectUriAutocomplete\(snapshot,key\)/);
  assert.match(c,/No results/);
  assert.match(c,/role="alert"/);
  assert.match(c,/UNABLE_TO_GET_ISSUER_CERT_LOCALLY/);
});

test('View hover diagnostics are read-only and distinguish missing SHACL reports',()=>{
  const d=read('src/canvas/top/view-diagnostics-hover.tsx');
  const p=read('src/lib/client-provider-diagnostics.ts');
  assert.match(d,/openOnHover delay=\{100\} closeDelay=\{250\}/);
  assert.match(d,/mui:Providers/);
  assert.match(d,/Caller:/);
  assert.match(p,/sh:ValidationReport/);
  assert.match(p,/lastRequestComponent/);
  assert.match(p,/validation:.*"unknown"/s);
  assert.doesNotMatch(d,/href=|onClick=/);
});

test('all changed TypeScript / TSX documents parse cleanly',()=>{
  for(const p of ['src/lib/app-lifecycle/root-breadcrumb.ts','src/lib/uri-autocomplete-query.ts','src/lib/client-provider-diagnostics.ts','src/canvas/top/root-uri-autocomplete.tsx','src/canvas/top/breadcrumb-renderers.tsx','src/canvas/top/breadcrumb.tsx','src/canvas/utils/workspace-controller.tsx','src/canvas/controllers/query-session.ts','src/canvas/top/appbar-pane.tsx','src/canvas/top/view-diagnostics-hover.tsx']){
    const parsed=ts.createSourceFile(p,read(p),ts.ScriptTarget.Latest,true,p.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(parsed.parseDiagnostics.length,0,`${p}: ${parsed.parseDiagnostics.map(d=>d.messageText).join('; ')}`);
  }
});
