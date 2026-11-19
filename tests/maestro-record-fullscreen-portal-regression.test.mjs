import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
function loadCompiled(source, mocks = {}) {
  const sourceText = read(source);
  const compiled = ts.transpileModule(sourceText, {
    fileName: source, compilerOptions: { target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length || 0, 0);
  const module = { exports: {} };
  const mockRequire = (name) => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unmocked module ${name}`);
  };
  const wrapper = vm.runInNewContext(`(function(require,module,exports,Node){${compiled.outputText}\n})`);
  wrapper(mockRequire, module, module.exports, { TEXT_NODE: 3, ELEMENT_NODE: 1 });
  return module.exports;
}
class FakeNode {
  constructor(tag, children = [], attributes = {}) {
    this.nodeType = tag === '#text' ? 3 : 1;
    this.localName = tag;
    this.nodeName = tag;
    this.textContent = this.nodeType === 3 ? String(children) : null;
    this.childNodes = this.nodeType === 3 ? [] : children;
    this.parentElement = null;
    this.attributeMap = { ...attributes };
    this.attributes = Object.entries(attributes).map(([name, value]) => ({name, value}));
    this.id = attributes.id ?? '';
    this.style = {};
    for (const child of this.childNodes) child.parentElement = this;
    this.replaceCount = 0;
  }
  setAttribute(name, value) {
    this.attributeMap[name] = value;
    this.attributes = Object.entries(this.attributeMap).map(([name, value]) => ({name, value}));
  }
  replaceChildren(...newChildren) {
    this.replaceCount++;
    this.childNodes = newChildren;
    for (const child of newChildren) child.parentElement = this;
  }
  querySelectorAll() {
    const all = [];
    const visit = node => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        all.push(child);
        visit(child);
      }
    };
    visit(this);
    return all;
  }
}
function portalBridge() {
  const RecordValuePages = () => undefined;
  const created = [];
  const library = loadCompiled('src/components/maestro-xslt-components.tsx', {
    'react': { createElement: (component, props, ...children) => ({ component, props, children }) },
    'react-dom': { createPortal: (rendered, host, key) => {
      const portal = { rendered, host, key };
      created.push(portal);
      return portal;
    } },
    'maplibre-gl': { setWorkerUrl() {} },
    '@/components/generated/maestro-component-registry': { maestroComponentRegistry: {} },
    '@/components/ui/record-value-pages': { RecordValuePages },
  });
  return { library, RecordValuePages, created };
}
function makeRecordHost(label) {
  const value = new FakeNode('span', [new FakeNode('#text', label)], { 'property': 'urn:director' });
  const paging = new FakeNode('recordvaluepages', [value], { id: `values-${label}`, pageSize: '5' });
  const dl = new FakeNode('div', [paging]);
  return { root: new FakeNode('section', [dl]), paging };
}
function renderedText(portal) { let node = portal.rendered; while (node && typeof node !== 'string') node = node.children?.[0]; return node; }

test('RecordValuePages portal retains original RDF values when a fullscreen effect is replayed', () => {
  const { library, RecordValuePages } = portalBridge();
  const { root, paging } = makeRecordHost('Director One');
  const first = library.getMaestroComponentPortals(root);
  assert.equal(first.length, 1);
  assert.equal(first[0].rendered.component, RecordValuePages);
  assert.equal(renderedText(first[0]), 'Director One');
  assert.equal(paging.replaceCount, 1);
  // React has mounted a live portal subtree after the XSLT blueprint was removed.
  paging.childNodes.push(new FakeNode('span', [new FakeNode('#text', 'mounted by React')]));
  const replay = library.getMaestroComponentPortals(root);
  assert.equal(replay.length, 1);
  assert.equal(renderedText(replay[0]), 'Director One');
  assert.equal(paging.replaceCount, 1, 'never clear a live portal on effect replay');
  assert.equal(paging.childNodes.length, 1, 'live mounted children stay attached');
});

test('separate Record session panes retain their own independent value blueprints', () => {
  const { library } = portalBridge();
  const firstHost = makeRecordHost('Elephant Director');
  const pivotHost = makeRecordHost('Pivot Director');
  assert.equal(renderedText(library.getMaestroComponentPortals(firstHost.root)[0]), 'Elephant Director');
  assert.equal(renderedText(library.getMaestroComponentPortals(pivotHost.root)[0]), 'Pivot Director');
  assert.equal(renderedText(library.getMaestroComponentPortals(firstHost.root)[0]), 'Elephant Director');
});

test('Browse root changes cancel obsolete fullscreen pivot requests; breadcrumb focus does not', () => {
  const { RecordSessionsController } = loadCompiled('src/canvas/controllers/record-session-model.ts');
  const initial = { value: 'urn:film:1', termType: 'uri', queryXml: '<query/>' };
  const controller = new RecordSessionsController(initial);
  const pivot = controller.appendPivot({value:'urn:person:1',termType:'uri',queryXml:'<query/>'},
    {subjectSessionId:'record-0',predicate:'urn:director',direction:'property'}, 0);
  const pivotRequest = new AbortController();
  const rootRequest = new AbortController();
  controller.registerRequest(pivot.id, pivotRequest);
  controller.registerRequest('record-0', rootRequest);
  controller.focusSession(0);
  assert.equal(pivotRequest.signal.aborted, false);
  controller.selectBrowseRecord({...initial});
  assert.equal(pivotRequest.signal.aborted, false, 'same root must not invalidate pivots');
  controller.selectBrowseRecord({value:'urn:film:2',termType:'uri',queryXml:'<query/>'});
  assert.equal(pivotRequest.signal.aborted, true);
  assert.equal(rootRequest.signal.aborted, true);
  assert.equal(controller.snapshot().sessions.length, 1);
  assert.equal(controller.snapshot().sessions[0].identity.value, 'urn:film:2');
  assert.throws(() => controller.appendPivot({value:'urn:wrong',termType:'uri',queryXml:'<query/>'},
    {subjectSessionId: pivot.id,predicate:'urn:foo',direction:'property'}, 1), /no longer available/);
});

test('fullscreen keeps XState keys scoped to meaningful graph selection, not background graph discovery', () => {
  const pivotSource = read('src/canvas/controllers/record-session-controller.tsx');
  const explorerSource = read('src/canvas/right/record-explorer.tsx');
  assert.match(pivotSource, /const selectedGraphScope = own\.selectedRecordAuthor/);
  assert.match(pivotSource, /own\.selectedRecordAuthor, selectedGraphScope, browse\.recordDescriptionQueryLimit/);
  assert.doesNotMatch(pivotSource, /own\.selectedRecordAuthor, recordGraphs\.join/);
  assert.match(explorerSource, /useLayoutEffect\(\(\) => \{[\s\S]*?controller\.selectBrowseRecord\(rootIdentity\)/);
  assert.match(explorerSource, /setSnapshot\(controller\.snapshot\(\)\);\s*setMarked\(\[\]\)/);
});
