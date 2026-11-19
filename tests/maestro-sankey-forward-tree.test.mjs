import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projectSankeyCoverage } from '../src/lib/sankey-coverage.ts';
import { sankeyBranchesAtFocus, allSankeyBranches, sankeyInitialTerms, extendSankeyThroughQueryTree, sankeyTermKey } from '../src/lib/sankey-query-tree.ts';

const node=(id,iri,children=[],name='property')=>({id,name,attributes:{iri},children});
const focus=[node('loc','urn:location',[
  node('dev','urn:developer',[node('maker','urn:manufacturer')]),
  node('role','urn:employer',[], 'property-of'),
]),node('category','urn:category')];
const branches=sankeyBranchesAtFocus(focus,(iri,direction)=>`${iri}${direction==='reverse'?' of':''}`);
const u=value=>({type:'uri',value});
const base=projectSankeyCoverage([
  {iri:'urn:location',direction:'forward',label:'Location'},
  {iri:'urn:category',direction:'forward',label:'Category'},
], [{uri:'urn:r',label:'Record',values:[
  {property:'urn:location',direction:'forward',values:[u('urn:p')]},
  {property:'urn:category',direction:'forward',values:[u('urn:c')]},
]}], 'Everything › Focus');

test('every descendant of the current focus is in the query-tree projection, including siblings and reverse roles',()=>{
  assert.deepEqual(allSankeyBranches(branches).map(branch=>branch.id), ['loc','dev','maker','role','category']);
  assert.equal(branches[0].children[1].direction,'reverse');
  assert.equal(branches[1].children.length,0);
  assert.deepEqual([...sankeyInitialTerms(base,branches).keys()],['loc']);
});

test('walks forward from focus to every observed nested branch, never creates ancestry or RDF cycles',()=>{
  const graph=extendSankeyThroughQueryTree(base,branches,[
    {branchId:'dev',parent:u('urn:p'),child:u('urn:d')},
    {branchId:'maker',parent:u('urn:d'),child:u('urn:r')}, // RDF cycle is safe: query-tree nodes are different
    {branchId:'role',parent:u('urn:p'),child:u('urn:e')},
  ]);
  assert.equal(graph.nodes[0].name,base.nodes[0].name);
  assert.deepEqual(graph.coverage,base.coverage);
  assert.deepEqual(graph.links.slice(0,base.links.length),base.links);
  assert.deepEqual(graph.nodes.slice(0,base.nodes.length),base.nodes);
  assert.equal(graph.nodes.filter(node=>node.kind==='predicate').length,base.nodes.filter(node=>node.kind==='predicate').length+3);
  assert.ok(graph.nodes.find(node=>node.kind==='value'&&node.uri==='urn:e'));
  assert.ok(graph.nodes.find(node=>node.kind==='value'&&node.uri==='urn:r'));
  const n=graph.nodes;
  const dev=n.findIndex((item,index)=>index>=base.nodes.length&&item.kind==='predicate'&&item.uri==='urn:developer');
  const maker=n.findIndex((item,index)=>index>=base.nodes.length&&item.kind==='predicate'&&item.uri==='urn:manufacturer');
  const role=n.findIndex((item,index)=>index>=base.nodes.length&&item.kind==='predicate'&&item.uri==='urn:employer');
  assert.ok(dev>=0&&maker>=0&&role>=0);
  assert.ok(graph.links.some(link=>link.target===dev));
  assert.ok(graph.links.some(link=>link.target===role));
  assert.ok(graph.links.some(link=>link.target===maker));
  // Every extended node has at most as much outbound flow as real inbound flow.
  for(let i=base.nodes.length;i<graph.nodes.length;i++){
    const incoming=graph.links.filter(link=>link.target===i).reduce((sum,link)=>sum+link.value,0);
    const outgoing=graph.links.filter(link=>link.source===i).reduce((sum,link)=>sum+link.value,0);
    assert.ok(outgoing<=incoming+1e-9,`node ${i}: ${outgoing} > ${incoming}`);
  }
});

test('typed RDF terms remain distinct across descendants; absent values never create links',()=>{
  assert.notEqual(sankeyTermKey({type:'uri',value:'urn:x'}),sankeyTermKey({type:'literal',value:'urn:x'}));
  assert.notEqual(sankeyTermKey({type:'literal',value:'x',lang:'en'}),sankeyTermKey({type:'literal',value:'x',lang:'fr'}));
  assert.equal(extendSankeyThroughQueryTree(base,branches,[]),base);
  const unknown=extendSankeyThroughQueryTree(base,branches,[{branchId:'dev',parent:u('urn:not-on-page'),child:u('urn:d')}]);
  assert.equal(unknown.nodes.length,base.nodes.length);
  assert.equal(unknown.links.length,base.links.length);
});

test('Sankey reads the current query focus and follows descendant FCT edges with cancellable bounded list-values requests; pages via existing FCT controls',()=>{
  const canvas=fs.readFileSync('src/canvas/tab/analyze/sankey.tsx','utf8');
  assert.match(canvas,/findQueryNode\(workspace\.queryTree\.children,focusId\)/);
  assert.match(canvas,/sankeyBranchesAtFocus\(focus\?\.children/);
  assert.match(canvas,/branch\.children/);
  assert.match(canvas,/cachedFetchFct\("\/proxy\/api\/fct"/);
  assert.match(canvas,/parseListValuesXml\(xml\)/);
  assert.match(canvas,/controller\.abort\(\)/);
  assert.match(canvas,/extendSankeyThroughQueryTree\(base,branches,currentForward\.edges\)/);
  assert.match(canvas,/workspace\.changeResultsPage\(1\)/);
  assert.match(canvas,/workspace\.changeResultsPage\(-1\)/);
  assert.match(canvas,/setChartPage\(selectedPage\+1\)/);
  assert.doesNotMatch(canvas,/extendSankeyWithBreadcrumbs|SankeyAncestorLink|breadcrumb.*backwards/i);
});
