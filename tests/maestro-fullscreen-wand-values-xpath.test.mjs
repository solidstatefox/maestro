import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript'); // Resolve the project's declared devDependency on every supported OS.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function loadWandQuery() {
  let counter = 200;
  const clone = obj => structuredClone(obj);
  const find = (tree, id) => {
    const walk = nodes => { for (const node of nodes) { if (node.id === id) return node; const child = walk(node.children); if (child) return child; } return null; };
    return walk(tree.children);
  };
  const api = {
    getDataTree: clone,
    resetQuery: tree => ({ ...clone(tree), children: [] }),
    setSearchText: tree => tree,
    insertNode: (tree, parentId, node) => {
      const next = clone(tree);
      const parent = parentId ? find(next, parentId) : null;
      assert.ok(!parentId || parent);
      (parent ? parent.children : next.children).push(clone(node));
      return next;
    },
    setValue: (tree, parentId, values) => {
      const next = clone(tree);
      const parent = find(next, parentId);
      assert.ok(parent, 'value must have a property parent');
      for (const value of values) parent.children.push({
        id: `v-${counter++}`, name: 'value', text: value.text,
        attributes: { datatype: value.datatype, ...(value.lang ? { 'xml:lang': value.lang } : {}) }, children: [],
      });
      return next;
    },
  };
  const text = read('src/lib/record-explorer-query.ts');
  const compiled = ts.transpileModule(text, {compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {})((module) => {
    if (module === './fct-node-identity') return { nextFctQueryId: () => ({id: `p-${counter++}`}) };
    if (module === './fct-query-api') return { fctQueryTreeApi: api };
    if (module === './maestro-kinds') return { MAESTRO_KIND_IDS: [], classifyMaestroKind: () => null };
    throw new Error(module);
  }, {exports}, exports);
  return exports;
}

test('Pointer Record clicks pivot on value without requiring Shift; property clicks stay local', () => {
  const pane = read('src/canvas/right/pane.tsx');
  const fullscreen = pane.split('if (fullscreenPane) {')[1]?.split('// Browse keeps its existing behavior')[0] ?? '';
  assert.match(fullscreen, /resolveFullscreenRecordTarget\(target, rows\)/);
  assert.match(fullscreen, /picked\.kind === "value" && picked\.statement\.value/);
  assert.match(fullscreen, /intent: "pivot", kind: "value"/);
  assert.doesNotMatch(fullscreen, /event\.shiftKey &&/);
  assert.doesNotMatch(fullscreen, /navigateResultBadge\(|openRecordPropertyUri\(|applyRecordAsRootValue\(/);
  assert.match(read('src/canvas/right/record-source-highlight.css'), /data-maestro-record-interactive="property"[\s\S]*?cursor: pointer/);
});

test('Wand distinguishes predicate-only selection from exact URI and typed/language literal values', () => {
  const { buildWandQuery, wandPropertyNodeId } = loadWandQuery();
  const source = { name: 'query', attributes: {addr:'@urn:server',ctr:'200'}, children: [] };
  const trail = [{predicate:'urn:author',direction:'property'}];
  const marked = [
    {recordIndex:0,predicate:'urn:producer',direction:'property',kind:'property'},
    {recordIndex:0,predicate:'urn:producer',direction:'property',kind:'value',value:'urn:john',termType:'uri'},
    {recordIndex:0,predicate:'urn:producer',direction:'property',kind:'value',value:'John',termType:'literal',lang:'en'},
    {recordIndex:1,predicate:'urn:starring',direction:'property-of',kind:'value',value:'urn:star',termType:'uri'},
  ];
  const draft = buildWandQuery(source,trail,marked);
  const producer = draft.children.find(n=>n.attributes.iri==='urn:producer');
  assert.ok(producer);
  assert.equal(draft.children.filter(n=>n.attributes.iri==='urn:producer').length,1);
  assert.equal(producer.children.filter(n=>n.name==='value').length,2);
  assert.ok(producer.children.some(n=>n.text==='urn:john'&&n.attributes.datatype==='uri'));
  assert.ok(producer.children.some(n=>n.text==='John'&&n.attributes['xml:lang']==='en'));
  assert.ok(producer.children.some(n=>n.text==='John'&&n.attributes.datatype === undefined),
    'language-tagged literals must not also claim a conflicting datatype');
  assert.equal(wandPropertyNodeId(draft,trail,marked[0]), producer.id);
  assert.equal(wandPropertyNodeId(draft,trail,marked[1]), producer.id,
    'property and value share a displayed property node ID, not duplicate XML IDs');
  const root = draft.children.find(n=>n.attributes.iri==='urn:author');
  assert.ok(root);
  const starring = root.children.find(n=>n.name==='property-of'&&n.attributes.iri==='urn:starring');
  assert.ok(starring);
  assert.equal(starring.children[0].attributes.datatype,'uri');
  assert.equal(wandPropertyNodeId(draft,trail,marked[3]),starring.id);
  const propertyOnly = buildWandQuery(source,trail,marked.slice(0,1));
  assert.equal(propertyOnly.children[0].children.length,0);
});

test('Wand supports exact value selection and local removal without changing Browse', () => {
  const explorer = read('src/canvas/right/record-explorer.tsx');
  assert.match(explorer, /kind === "value" && binding\.termType === "bnode"/);
  assert.match(explorer, /item\.value === binding\.value && item\.termType === binding\.termType/);
  const pane = read('src/canvas/right/pane.tsx');
  assert.match(pane, /createPortal\(/);
  assert.match(pane, /<InputGroup key=/);
  assert.match(pane, /<InputGroupAddon/);
  assert.match(pane, /data-maestro-inline-wand-slot/);
  assert.doesNotMatch(explorer, /aria-label="Wand query selections"/,
    "Wand selections must appear inline in the Record, not in a top tray");
  assert.match(explorer, /wandPropertyNodeId\(wandDraft, trail, item\)/);
  assert.match(explorer, /replaceTree\(buildWandQuery\(queryTree, trail, marked\)\)/);
  const decoration = read('src/canvas/controllers/record-rdfa-decoration.ts');
  assert.match(decoration, /found\.kind === "property" \|\|/);
  assert.match(decoration, /sameSelection/);
});

test('Both Sunburst stylesheets fix the malformed XPath font-size expression', () => {
  for (const path of ['graph/sunburst/provider.ttl','graph/sunburst-chartkit/provider.ttl']) {
    const ttl=read(path);
    assert.match(ttl, /name="outward" select="math:sin\(\$mid\) ge 0"/);
    assert.match(ttl, /text-anchor="\{if \(\$outward\) then 'start' else 'end'\}" font-size="10"/);
    assert.match(ttl, /overflow="visible"/);
    assert.doesNotMatch(ttl, /name="radial-room"/);
    assert.match(ttl, /name="caption-room"/);
    assert.match(ttl, /name="font" select="max\(\(5\.5, min\(\(11, 6 \+ \$span \* 4, \$caption-room\)\)\)\)"/);
    assert.doesNotMatch(ttl, /format-number\(min\(\(11,max\(/);
  }
});

function loadDecoration() {
  const code = ts.transpileModule(read('src/canvas/controllers/record-rdfa-decoration.ts'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {})((name) => {throw Error(name)}, {exports}, exports);
  return exports;
}

class RdfaElement {
  constructor(tag, attributes={}, parent=null, text='') {
    this.tag=tag; this.attrs={...attributes}; this.parent=parent; this.textContent=text;
    this.children=[]; if(parent)parent.children.push(this);
  }
  getAttribute(name) {return this.attrs[name] ?? null;}
  hasAttribute(name) {return name in this.attrs;}
  setAttribute(name, value) {this.attrs[name]=value;}
  removeAttribute(name) {delete this.attrs[name];}
  matches(selector) {
    if (selector.includes(' ')) {
      const [parent,child] = selector.split(' ');
      return this.matches(child) && this.parent?.matches(parent);
    }
    const tag=selector.match(/^[a-z-]+/i)?.[0];
    if(tag&&this.tag!==tag)return false;
    const attrs=[...selector.matchAll(/\[([\w:-]+)(?:=(["']?)([^\]]+)\2)?\]/g)];
    return attrs.every(([_,name])=>name in this.attrs);
  }
  closest(selectors) {
    for(let node=this;node;node=node.parent)
      if(selectors.split(',').some(selector=>node.matches(selector.trim())))return node;
    return null;
  }
  querySelectorAll(selector) {
    const result=[];
    const visit=node=>{for(const child of node.children){if(selector.split(',').some(sel=>child.matches(sel.trim())))result.push(child);visit(child);}};
    visit(this);return result;
  }
}

test('RDFa click resolution and Wand decoration distinguish property target from value target', () => {
  const {resolveFullscreenRecordTarget,decorateWandedRecordProperties,decorateRecordInteractiveTargets} = loadDecoration();
  const row={predicate:'urn:producer',direction:'property',termType:'uri',value:'urn:john'};
  const host=new RdfaElement('div');
  const label=new RdfaElement('button',{'about':'urn:producer','data-maestro-predicate':'urn:producer'},host,'Producer');
  const value=new RdfaElement('div',{'data-maestro-property-value':'true','data-maestro-predicate':'urn:producer',rel:'urn:producer',resource:'urn:john'},host,'John');
  const child=new RdfaElement('button',{},value,'John');
  assert.equal(resolveFullscreenRecordTarget(label,[row]).kind,'property');
  const target=resolveFullscreenRecordTarget(child,[row]);
  assert.equal(target.kind,'value');
  assert.equal(target.statement.value,'urn:john');
  decorateRecordInteractiveTargets(host,[row]);
  assert.equal(label.getAttribute('data-maestro-record-interactive'),'property');
  assert.equal(value.getAttribute('data-maestro-record-interactive'),'value');
  decorateWandedRecordProperties(host,[{predicate:'urn:producer',direction:'property',kind:'property'}],[row]);
  assert.equal(label.getAttribute('data-maestro-wanded'),'property');
  assert.equal(value.getAttribute('data-maestro-wanded'),null,'property Wand must not paint its values');
  decorateWandedRecordProperties(host,[{predicate:'urn:producer',direction:'property',kind:'value',value:'urn:john',termType:'uri'}],[row]);
  assert.equal(label.getAttribute('data-maestro-wanded'),'property', 'a value Wand must mark its predicate with the same query node');
  assert.equal(value.getAttribute('data-maestro-wanded'),'value');
  assert.equal(child.getAttribute('data-maestro-wanded'),null);
});


test('A plain formatter <dd> literal is clickable only with exact unique RDF identity', () => {
  const {resolveFullscreenRecordTarget} = loadDecoration();
  const host=new RdfaElement('div');
  const dd=new RdfaElement('dd',{},host);
  const literal=new RdfaElement('span',{},dd,'January 1, 2003');
  const value={predicate:'urn:premiere',direction:'property',termType:'literal',value:'January 1, 2003'};
  assert.equal(resolveFullscreenRecordTarget(literal,[value]).kind,'value');
  assert.equal(resolveFullscreenRecordTarget(literal,[value,{...value,predicate:'urn:other'}]),null,
    'ambiguous formatter text must never create an arbitrary RDF relation');
});

test('Wand styling selects the property or value atom and not its enclosing row', () => {
  const css=read('src/canvas/right/record-source-highlight.css');
  assert.match(css, /\[data-maestro-wanded\]:not\(\[data-maestro-followed-source\]\)/);
  assert.match(css, /data-maestro-record-interactive="property"/);
  const code=read('src/canvas/controllers/record-rdfa-decoration.ts');
  assert.match(code, /found\.kind === "value"/);
  assert.match(code, /const atom = found\.kind === "value"/);
  assert.doesNotMatch(code,/closest\("tr"\)\?\.setAttribute\("data-maestro-wanded"/);
});

test('Legacy table-valued RDFa and duplicate URI labels preserve their statement identities', () => {
  const {resolveFullscreenRecordTarget} = loadDecoration();
  const host = new RdfaElement('div');
  const first = new RdfaElement('tr',{'data-maestro-predicate':'urn:producer'},host);
  const firstCell = new RdfaElement('td',{},first);
  const firstLink = new RdfaElement('a',{href:'urn:shared'},firstCell,'Same person');
  const second = new RdfaElement('tr',{'data-maestro-predicate':'urn:director'},host);
  const secondCell = new RdfaElement('td',{},second);
  const secondLink = new RdfaElement('a',{href:'urn:shared'},secondCell,'Same person');
  const literalRow = new RdfaElement('tr',{'data-maestro-predicate':'urn:year'},host);
  const literalCell = new RdfaElement('td',{},literalRow);
  const literal = new RdfaElement('span',{},literalCell,'2005');
  const rows = [
    {predicate:'urn:producer',direction:'property',value:'urn:shared',termType:'uri'},
    {predicate:'urn:director',direction:'property',value:'urn:shared',termType:'uri'},
    {predicate:'urn:year',direction:'property',value:'2005',termType:'literal'},
  ];
  assert.equal(resolveFullscreenRecordTarget(firstLink,rows)?.statement.predicate,'urn:producer');
  assert.equal(resolveFullscreenRecordTarget(secondLink,rows)?.statement.predicate,'urn:director');
  assert.equal(resolveFullscreenRecordTarget(literal,rows)?.statement.value,'2005');
});
