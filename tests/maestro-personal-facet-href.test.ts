import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPropertyWidgetQuery, createPersonalFacetValuesQuery, createGroupValuesQuery, createGroupMemberQuery, createDistinctCountQuery, setQueryViewAttributes } from "../src/lib/fct-query-derived";
import { fctQueryTreeApi, type FctQueryTree, type FctQueryNode } from "../src/lib/fct-query-api";
import { activeTransportedFacets } from "../src/lib/fct-facet-alias";
import { serializeFctQuery } from "../src/lib/fct-query-serialize";
import { compileFctXmlToSparql } from "../src/lib/fct-sparql-translator";
import { buildFctCountSparql } from "../src/lib/fct-count-sparql";

const classification = "http://data.europa.eu/s66#hasEuroSciVocClassification";
const classificationValue = "http://data.europa.eu/8mn/euroscivoc/61bab820-648f-4f84-9f2d-71b5f80c5835";
const alt = "http://www.w3.org/2008/05/skos-xl#altLabel";
const terminal = "http://www.w3.org/2008/05/skos-xl#literalForm";
const n = (id: string, name: string, attributes: Record<string,string> = {}, children: FctQueryNode[] = [], text?: string): FctQueryNode => ({id,name,attributes,children,...(text === undefined ? {} : {text})});
const source = (): FctQueryTree => ({ name:"query", attributes:{xmlns:"http://openlinksw.com/services/facets/1.0",addr:"$ALL$@https://cordis.europa.eu/datalab/sparql",id:"a",ctr:"370",uctr:"a",rctr:"n"},children:[
  n("a3","property",{iri:classification,rid:"i"},[
    n("a4","value",{datatype:"uri"},[],classificationValue),
    n("a6","property",{iri:alt,rid:"k"},[n("a8","property",{iri:terminal,rid:"m"})]),
  ]),
  n("a9","a",{href:"a8"}),
  n("a2","view",{type:"list",limit:"6",offset:"0"}),
] });
const views = (tree: FctQueryTree) => {
  const carriers: {id:string,view:FctQueryNode}[]=[];
  const walk = (parent: FctQueryTree | FctQueryNode) => {
    for(const child of parent.children) {
      if(child.name === "view") carriers.push({id:"id" in parent ? parent.id : parent.attributes.id,view:child});
      else walk(child);
    }
  };
  walk(tree); return carriers;
};
const find = (tree: FctQueryTree, id: string): FctQueryNode => {
  const walk = (nodes: FctQueryNode[]): FctQueryNode | undefined => {
    for(const node of nodes){ if(node.id===id) return node; const found=walk(node.children);if(found)return found; }
  };
  const found = walk(tree.children);assert.ok(found);return found;
};

test("CORDIS href Personal list moves the one cloned view to the exact terminal literalForm node",()=>{
  const tree=source(), before=structuredClone(tree);
  const [anchor]=activeTransportedFacets(tree);
  assert.deepEqual(anchor.path.map(h=>h.id),["a3","a6","a8"]);
  const list=setQueryViewAttributes(createPropertyWidgetQuery(tree,terminal,"forward",undefined,true,anchor.href),{limit:"1000",sort:""});
  assert.deepEqual(views(list).map(v=>[v.id,v.view.id,v.view.attributes.type]),[["a8","a2","list"]]);
  assert.equal(find(list,"a4").text,classificationValue);
  assert.equal(views(tree)[0].id,"a");
  assert.deepEqual(tree,before);
  const xml=serializeFctQuery(list);
  assert.doesNotMatch(xml,/<a\b|\bgroup=|transportedGroupTarget/);
  const compiled=compileFctXmlToSparql(xml);
  const literalBinding=compiled.query.match(/\?\w+ <http:\/\/www\.w3\.org\/2008\/05\/skos-xl#literalForm> (\?\w+) \./);
  assert.ok(literalBinding,compiled.query);
  assert.equal(compiled.target,literalBinding[1]);
  assert.match(compiled.query,new RegExp(`\\(${literalBinding[1].replace("?","\\?")} AS \\?c1\\)`));
  assert.doesNotMatch(compiled.query,/GROUP BY|\?groupValue/);
  assert.ok(compiled.query.includes(classificationValue));
});

test("scalar count helper preserves the original population and exact href binding, though Personal facets no longer call it",()=>{
  const tree=source(), before=structuredClone(tree);
  for(const uri of ["Multilingualism","linguistic"]) {
    const count=createDistinctCountQuery(tree,"value",uri,terminal,{uri,termType:"literal",lang:"en"},"list-count",{direction:"forward",href:"a8"});
    assert.deepEqual(views(count).map(v=>[v.id,v.view.id,v.view.attributes.type]),[["a","a2","list-count"]]);
    assert.equal(find(count,"a4").text,classificationValue);
    assert.equal(find(count,"a8").children.find(c=>c.name==="value")?.text,uri);
    const xml=serializeFctQuery(count);
    assert.doesNotMatch(xml,/<a\b|\bgroup=|transportedGroupTarget/);
    assert.match(xml,/xml:lang="en"/);
    const scalar=buildFctCountSparql(count);
    assert.ok(scalar?.includes(`"${uri}"@en`),scalar ?? "Count failed to compile");
    const executed=compileFctXmlToSparql(xml,undefined,false,true);
    assert.match(executed.query,/COUNT\(DISTINCT \?s1\)/i);
    assert.ok(executed.query.includes(`"${uri}"@en`),executed.query);
    assert.equal(executed.countOnly,true);
  }
  assert.deepEqual(tree,before);
});

test("href selects exact repeated/reverse relationship; checkbox uses ordinary node-aware setter",()=>{
  const tree=source();
  tree.children.unshift(n("aa","property",{iri:terminal,rid:"o"}));
  const target=find(tree,"a8");target.name="property-of";
  const list=createPropertyWidgetQuery(tree,terminal,"reverse",undefined,true,"a8");
  assert.equal(views(list)[0].id,"a8");
  assert.equal(find(list,"aa").children.length,0);
  const value={text:"linguistic",lang:"en"};
  const selected=fctQueryTreeApi.setPropertyValue(tree,null,terminal,value,true,"a8");
  assert.equal(find(selected,"a8").children.find(c=>c.name==="value")?.text,"linguistic");
  assert.equal(find(selected,"aa").children.length,0);
  assert.equal(views(selected)[0].id,"a");
  const cleared=fctQueryTreeApi.setPropertyValue(selected,null,terminal,value,false,"a8");
  assert.equal(find(cleared,"a8").children.filter(c=>c.name==="value").length,0);
  assert.throws(()=>createPropertyWidgetQuery(tree,terminal,"forward",undefined,true,"missing"),/href/);
  const count=createDistinctCountQuery(tree,"value","urn:resource",terminal,{uri:"urn:resource",termType:"uri"},"list-count",{direction:"reverse",href:"a8"});
  assert.equal(views(count)[0].id,"a");
  assert.equal(find(count,"aa").children.length,0);
  assert.equal(find(count,"a8").children.find(c=>c.name==="value")?.text,"urn:resource");
});

test("ordinary Personal list/count remains unchanged without href, and the renderer has no alias count exemption",()=>{
  const tree=source();
  const local=createPropertyWidgetQuery(tree,classification,"forward",undefined,true);
  assert.equal(views(local)[0].id,"a3");
  const count=createDistinctCountQuery(tree,"value",classificationValue,classification,{uri:classificationValue,termType:"uri"},"list-count",{direction:"forward"});
  assert.equal(views(count)[0].id,"a");
  const cards=readFileSync("src/canvas/left/personal-widget-cards.tsx","utf8");
  const listener=readFileSync("src/canvas/left/filter.tsx","utf8");
  assert.doesNotMatch(cards+listener,/createTransportedFacetQuery/);
  assert.doesNotMatch(cards,/Boolean\(alias\) \|\| facetCandidateCounts|isGroupByFacet \|\| alias/);
  assert.match(cards,/createPersonalFacetValuesQuery\(queryTree, widget\.uri, valueRelationship\.direction/);
  assert.match(cards,/widget\.valuesQueryXml/);
  assert.match(listener,/valuesQueryXml: widgetQueryXml/);
  assert.match(listener,/body: widgetQueryXml/);
  assert.match(listener,/personalFacetInspectorQueries\(valuesXml: string, executedSparql\?: string\)/);
  assert.doesNotMatch(listener,/personal-count-xml|personal-count-sparql|personal-groups-count/);
  assert.doesNotMatch(cards,/<DistinctCount|distinctCountQueryFor\(/);
  assert.match(cards,/facetMembershipCount\(value\)/);
});


test("CORDIS Personal and Group By share a counted LIST with the original Project population",()=>{
  const tree=source(), before=structuredClone(tree);
  const [anchor]=activeTransportedFacets(tree);
  const paging={limit:1000,offset:0};
  const personal=createPersonalFacetValuesQuery(tree,terminal,"forward",paging,undefined,anchor.href);
  const option={uri:terminal,direction:"forward" as const,key:`alias:${anchor.id}`,label:"Literal form",nodeId:anchor.href,anchorId:anchor.id,parentId:anchor.parentId};
  const groups=createGroupValuesQuery(tree,option,paging);
  assert.equal(serializeFctQuery(personal),serializeFctQuery(groups));
  const [{id,view}]=views(personal);
  assert.equal(id,"a8"); assert.equal(view.attributes.type,"list"); assert.equal(view.attributes.sort,"count");
  assert.equal(view.attributes.countAncestor,"3");
  const xml=serializeFctQuery(personal);
  assert.doesNotMatch(xml,/<a\b|\bgroup=|transportedGroupTarget/);
  const {query}=compileFctXmlToSparql(xml);
  assert.match(query,/\(\?s4 AS \?c1\)/);
  assert.match(query,/SELECT DISTINCT \(\?s4 AS \?c1\)\s+\?s1\b/);
  assert.match(query,/^SELECT \?c1\s+\(COUNT\(\*\) AS \?ct\)/);
  assert.match(query,/GROUP BY \?c1/);
  assert.ok(query.includes(classificationValue));
  const groupedLive=structuredClone(tree);find(groupedLive,"a9").attributes.group="true";
  find(groupedLive,"a2").attributes.limit="30";
  assert.equal(serializeFctQuery(createPersonalFacetValuesQuery(groupedLive,terminal,"forward",paging,undefined,anchor.href)),xml);
  const members=createGroupMemberQuery(tree,option,{uri:"Multilingualism",termType:"literal",lang:"en"});
  assert.equal(views(members)[0].id,"a");
  assert.ok(compileFctXmlToSparql(serializeFctQuery(members)).query.includes('"Multilingualism"@en'));
  assert.deepEqual(tree,before);
});

test("Nested focus counts the focus resource and not the root or terminal parent",()=>{
  const tree=source();
  const focus=n("ab","property-of",{iri:"urn:incoming"},tree.children);
  tree.children=[focus];
  const personal=createPersonalFacetValuesQuery(tree,terminal,"forward",{limit:100,offset:0},undefined,"a8");
  const query=compileFctXmlToSparql(serializeFctQuery(personal)).query;
  assert.match(query,/\(\?s5 AS \?c1\)/);
  assert.match(query,/SELECT DISTINCT \(\?s5 AS \?c1\)\s+\?s2\b/);
  assert.match(query,/^SELECT \?c1\s+\(COUNT\(\*\) AS \?ct\)/);
  assert.match(query,/GROUP BY \?c1/);
  assert.throws(()=>compileFctXmlToSparql(serializeFctQuery(setQueryViewAttributes(personal,{countAncestor:"99"}))),/countAncestor/);
});

test("LIST_COUNT still compiles its original raw-row aggregate and normal grouped list keeps its established semantics",()=>{
  const tree=source();
  const ordinary=createPersonalFacetValuesQuery(tree,classification,"forward",{limit:100,offset:0});
  const query=compileFctXmlToSparql(serializeFctQuery(ordinary)).query;
  assert.match(query,/SELECT DISTINCT \(\?s2 AS \?c1\)\s+\?s1\b/);
  assert.match(query,/^SELECT \?c1\s+\(COUNT\(\*\) AS \?ct\)/);
  assert.match(query,/GROUP BY \?c1/);
  const listCount=compileFctXmlToSparql(serializeFctQuery(setQueryViewAttributes(ordinary,{type:"list-count",sort:"count"}))).query;
  assert.match(listCount,/COUNT\(\*\) AS \?n/i);
  assert.doesNotMatch(listCount,/COUNT\(DISTINCT/);
});
