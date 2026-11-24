const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

let ts;
try { ts = require('typescript'); } catch {
  try { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); } catch { ts = null; }
}

const cleanTree = tree => JSON.parse(JSON.stringify(tree));
const removeGrouping = tree => {
  const clone = cleanTree(tree);
  const visit = nodes => nodes.forEach(node => {
    delete node.attributes.group;
    visit(node.children);
  });
  visit(clone.children);
  return clone;
};

// Exercise the actual createGroupValuesQuery function while stubbing only its
// FCT tree plumbing. This runs without React, Next.js, or an external endpoint.
function loadDerived() {
  const source = read('src/lib/fct-query-derived.ts');
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const fctTypes = { CLASSES: 'classes', LIST: 'list', TEXT: 'text', LIST_COUNT: 'list-count' };
  const attach = (tree, iri, name, view) => {
    const clone = cleanTree(tree);
    const detach = nodes => nodes.flatMap(node => node.name === 'view' ? [] : [{ ...node, children: detach(node.children) }]);
    clone.children = detach(clone.children);
    const append = nodes => nodes.some(node => {
      if (node.name === name && node.attributes.iri === iri) {
        node.children.push(cleanTree(view));
        return true;
      }
      return append(node.children);
    });
    assert.ok(append(clone.children), 'the grouped property must exist as a view sibling');
    return clone;
  };
  const fctQueryTreeApi = { getDataTree: cleanTree };
  const mocks = {
    './fct-view-types': { FCT_VIEW_TYPES: fctTypes },
    './fct-groups-carrier': { ungroupForMembers: removeGrouping },
    './bnode': { isBlankNodeTerm: () => false },
    './fct-get-path': {},
    './fct-query': { attachViewToPropertyInQueryTree: attach },
    './fct-query-api': { fctQueryTreeApi, cloneFctQueryNode: cleanTree },
  };
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, spec => {
    assert.ok(Object.hasOwn(mocks, spec), `unexpected dependency ${spec}`);
    return mocks[spec];
  });
  return mod.exports;
}

function stockTree() {
  return {
    name: 'query', attributes: { xmlns: 'http://openlinksw.com/services/facets/1.0' },
    children: [{ id: 'b', name: 'property-of', attributes: { iri: 'http://dbpedia.org/property/latitude' }, children: [
      { id: 'c', name: 'class', attributes: { iri: 'http://dbpedia.org/ontology/Place' }, children: [] },
      { id: 'd', name: 'property', attributes: { iri: 'http://dbpedia.org/property/sport', group: 'true' }, children: [] },
      { id: 'e', name: 'property', attributes: { iri: 'http://dbpedia.org/property/timezone' }, children: [] },
      { id: 'f', name: 'view', attributes: { type: 'text', sort: '', limit: '100', offset: '0' }, children: [] },
    ] }],
  };
}
const findView = nodes => {
  for (const node of nodes) {
    if (node.name === 'view') return node;
    const nested = findView(node.children);
    if (nested) return nested;
  }
  return null;
};

test('Stock sport grouping uses old count-sorted list view without mutating the live query', { skip: !ts }, () => {
  const { createGroupValuesQuery } = loadDerived();
  const source = stockTree();
  const groups = createGroupValuesQuery(source, {
    uri: 'http://dbpedia.org/property/sport', key: 'forward:http://dbpedia.org/property/sport',
    direction: 'forward', nodeId: 'd', label: 'sport',
  }, { limit: 20, offset: 0 });
  const derivedView = findView(groups.children);
  assert.equal(derivedView.attributes.type, 'list');
  assert.equal(derivedView.attributes.sort, 'count', 'otherwise column 2 is SAMPLE(latitude), not count');
  assert.equal(derivedView.attributes.limit, '20');
  assert.equal(derivedView.attributes.offset, '0');
  assert.ok(groups.children[0].children.find(node => node.id === 'd').children.some(node => node.name === 'view'),
    'the derived view belongs under sport');
  assert.equal(groups.children[0].children.find(node => node.id === 'd').attributes.group, undefined);
  assert.equal(source.children[0].children.find(node => node.id === 'd').attributes.group, 'true');
  assert.equal(findView(source.children).attributes.sort, '');
});

test('Category grouping uses the old count-sorted classes view', { skip: !ts }, () => {
  const { createGroupValuesQuery } = loadDerived();
  const source = stockTree();
  const groups = createGroupValuesQuery(source, {
    uri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', key: 'forward:rdf:type',
    direction: 'forward', nodeId: 'c', label: 'Category',
  }, { limit: 30, offset: 5 });
  assert.equal(findView(groups.children).attributes.type, 'classes');
  assert.equal(findView(groups.children).attributes.sort, 'count');
  assert.equal(findView(groups.children).attributes.offset, '5');
});

test('Facet and center derive group headings with identical createGroupValuesQuery paths', () => {
  const center = read('src/canvas/utils/workspace-controller.tsx');
  const facet = read('src/canvas/left/filter.tsx');
  const source = read('src/lib/fct-query-derived.ts');
  assert.match(center, /createGroupValuesQuery\(queryTree, selectedGroupByOption/);
  assert.match(facet, /createPersonalFacetValuesQuery\(tree, propertyUri/);
  assert.match(facet, /createPersonalFacetValuesQuery\(tree, uri, "reverse"/);
  assert.match(source, /return createPersonalFacetValuesQuery\(sourceTree, option\.uri, option\.direction, paging/);
  assert.match(source, /sort:\s*"count"/);
  const translator = read('src/lib/fct-sparql-translator.ts');
  assert.match(translator, /const isCountSorted = viewNode\?\.attributes\.sort === "count"/);
  assert.match(translator, /name: "COUNT", distinct: true/);
  assert.ok(!source.includes('list-groups'), 'old Group-by has no separate view type');
});

test('Every Personal property and Role row uses the FCT group count without a scalar request', () => {
  const property = read('src/canvas/left/personal-widget-cards.tsx');
  const role = read('src/canvas/left/filter.tsx');
  const roleWidget = role.slice(role.indexOf('export function PersonalRoleWidget('), role.indexOf('export function useFacetRuntimeState('));
  for (const widget of [property, roleWidget]) {
    assert.match(widget, /facetMembershipCount\(value\)/);
    assert.match(widget, /shortenCount\(groupedCount\)/);
    assert.doesNotMatch(widget, /<DistinctCount|distinctCountQueryFor\(/);
  }
  assert.match(role, /countedFacetValues\(Array\.isArray\(data\.results\)/);
});

test('counted Personal response requires ?ct, excludes zero rows, and preserves language-tagged values and counts', {skip: !ts}, () => {
  const js = ts.transpileModule(read('src/canvas/utils/fct-response.ts'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod = {exports:{}};
  // Only test pure row validation; no React, network or DOM is involved.
  new Function('module','exports','require',js)(mod,mod.exports,() => ({}));
  const {countedFacetValues,facetMembershipCount} = mod.exports;
  const row = (value, count, lang='en') => ({uri:value,title:value,termType:'literal',lang,matches:[],columns:[
    {value,termType:'literal',lang,attributes:{var:'c1'},raw:{}},
    {value:count,termType:'literal',datatype:'http://www.w3.org/2001/XMLSchema#integer',attributes:{var:'ct'},raw:{}}
  ]});
  const values=countedFacetValues([row('Multilingualism','316'),row('linguistic','316'),row('excluded','0'),row('linguistic','316')]);
  assert.deepEqual(values.map(v=>[v.uri,v.lang,facetMembershipCount(v)]),[['Multilingualism','en',316],['linguistic','en',316]]);
  for(const bad of ['', 'NaN', '-1', '1.5', 'Infinity']) assert.throws(()=>countedFacetValues([row('invalid',bad)]),/valid membership count/);
  const wrong=row('wrong','316');wrong.columns[1].attributes.var='n';
  assert.throws(()=>countedFacetValues([wrong]),/valid membership count/);
  assert.equal(facetMembershipCount({uri:'selected',matches:[]}),undefined);
});
