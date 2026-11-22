import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFctXmlToSparql } from "../src/lib/fct-sparql-translator";
import { serializeFctQuery } from "../src/lib/fct-query-serialize";
import { cloneFctQueryTree, snapshotFctQueryXml } from "../src/lib/fct-query-clone";
import { resolveTransportedFacets, activeTransportedFacets, transportedAnchorPath, toggleTransportedAnchor } from "../src/lib/fct-facet-alias";
import type { FctQueryNode, FctQueryTree } from "../src/lib/fct-query-api";

const rel = (id: string, iri: string, children: FctQueryNode[] = [], reverse = false): FctQueryNode => ({
  id, name: reverse ? "property-of" : "property", attributes: { iri }, children,
});
const view = (): FctQueryNode => ({ id: "v", name: "view", attributes: { type: "list", limit: "5" }, children: [] });
const tree = (): FctQueryTree => ({name:"query",attributes:{id:"q",addr:"$ALL$@https://example.org/sparql",ctr:"100"},children:[
  rel("a", "urn:one", [view(), rel("b", "urn:two", [rel("c", "urn:three", [], true)])]),
  rel("other", "urn:unrelated"),
  {id:"x",name:"value",attributes:{datatype:"uri"},text:"urn:subject",children:[]},
]});

const focusedDescendant = (): FctQueryTree => {
  const t = tree();
  const a = t.children[0], c = a.children[1].children[0];
  a.children = a.children.filter(item => item.name !== "view");
  c.children.push(view());
  return t;
};

test("Shift preview follows only strict ancestors of the focus including root", () => {
  const t = focusedDescendant();
  assert.deepEqual(transportedAnchorPath(t,"q")?.ids, ["q", "a", "b", "c"]);
  assert.deepEqual(transportedAnchorPath(t,"a")?.ids, ["a", "b", "c"]);
  assert.deepEqual(transportedAnchorPath(t,"b")?.path.map(h => h.direction), ["reverse"]);
  for(const invalid of ["c", "other", "missing", "v"]) assert.equal(transportedAnchorPath(t, invalid), null);
});

test("Shift click toggles a child of the selected ancestor without relocating view or bindings", () => {
  const before = focusedDescendant();
  const after = toggleTransportedAnchor(before, "a");
  assert.notStrictEqual(after, before);
  const owner = after.children[0];
  const anchor = owner.children.find(child => child.name === "a");
  assert.ok(anchor);
  assert.equal(anchor.attributes.href, "c");
  assert.deepEqual(resolveTransportedFacets(after).map(item => item.path.map(h => h.id)), [["b", "c"]]);
  assert.equal(owner.children[0].children[0].children[0].name, "view");
  assert.deepEqual(cloneFctQueryTree(before, "data"), cloneFctQueryTree(after, "data"));
  const removed = toggleTransportedAnchor(after,"a");
  assert.equal(resolveTransportedFacets(removed).length, 0);
  assert.deepEqual(cloneFctQueryTree(before, "data"), cloneFctQueryTree(removed, "data"));
});

test("an ancestor's anchor survives navigation back to its owning scope", () => {
  const before = toggleTransportedAnchor(focusedDescendant(),"a");
  assert.equal(activeTransportedFacets(before).length, 0);
  const navigated = structuredClone(before);
  const a = navigated.children[0], c = a.children[0].children[0];
  c.children = c.children.filter(child => child.name !== "view");
  a.children.push(view());
  assert.equal(activeTransportedFacets(navigated).length, 1);
  assert.equal(activeTransportedFacets(navigated)[0].target.id, "c");
});

test("nested a remains viewer-only in data-plane snapshots; merge-values retains explicit projection", () => {
  const a = toggleTransportedAnchor(focusedDescendant(),"a");
  const xml = serializeFctQuery(a);
  assert.match(xml, /<a\b[^>]*href="c"/);
  assert.doesNotMatch(snapshotFctQueryXml(xml, "data"), /<a\b/);
  const merged = `<query xmlns="http://openlinksw.com/services/facets/1.0"
    addr="$ALL$@https://example.org/sparql" id="q" ctr="100">
    <value id="x" datatype="uri">urn:subject</value><view id="v" type="merge-values"/>
    <property id="a" iri="urn:one" column="false">
      <property id="b" iri="urn:two">
        <property-of id="c" iri="urn:three"><a id="d" href="c"/></property-of>
      </property>
    </property>
  </query>`;
  const compiled=compileFctXmlToSparql(merged);
  const anchor=compiled.listValueProjections?.find(item=>item.id==="d");
  assert.ok(anchor,"nested anchor is visible as an explicitly derived projection column");
  assert.deepEqual(anchor.hops?.map(h=>h.direction),["forward","forward","reverse"]);
  // Historical aliases remain readable, but the new gesture creates an
  // ancestor-owned anchor rather than one attached to the target descendant.
  const legacy=tree();
  legacy.children[0].children.push({id:"legacy",name:"a",attributes:{href:"c"},children:[]});
  assert.equal(resolveTransportedFacets(legacy).length,1);
});

test("Record uses a formatted skeleton instead of an Empty card, preserving pending and no-selection states",()=>{
  const pane=readFileSync("src/canvas/right/pane.tsx","utf8");
  const skeleton=readFileSync("src/canvas/right/formatted-record-skeleton.tsx","utf8");
  assert.doesNotMatch(pane,/<Empty[ >]/);
  assert.match(pane,/<FormattedRecordSkeleton/);
  for(const label of ["Waiting for Results", "No Record selected", "Loading record (formatted)"]) assert.ok(pane.includes(label));
  for(const structure of ['data-maestro-record-skeleton="formatted"','Skeleton','grid grid-cols-2','role="status"']) assert.ok(skeleton.includes(structure));
});

test("Query Tree and breadcrumb Shift gesture use identical anchor controller and green path styling",()=>{
  const ctrl=readFileSync("src/canvas/utils/workspace-controller.tsx","utf8");
  const crumbs=readFileSync("src/canvas/top/breadcrumb-renderers.tsx","utf8");
  const personal=readFileSync("src/canvas/left/personal-widget-cards.tsx","utf8");
  assert.match(ctrl,/transportedAnchorPath\(queryTree, hoveredTransportedTargetId\)/);
  assert.match(ctrl,/toggleTransportedAnchor\(queryTree, targetId\)/);
  assert.match(ctrl,/data-maestro-anchor-preview/);
  assert.match(crumbs,/toggleTransportedAnchorAt\(crumb.id, event.shiftKey\)/);
  assert.match(crumbs,/hoveredTransportedAnchor\(crumb.id\)/);
  assert.match(personal,/ExternalLink/);
  assert.match(personal,/widget.anchor/);
});
