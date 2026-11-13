import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { featureFctQuery } from "../src/lib/feature-fct-query";
import { compileFctXmlToSparql } from "../src/lib/fct-sparql-translator";
import { isCoercibleNumericLexical } from "../src/lib/virtuoso-numeric-coercion";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const read = (relative: string) => readFileSync(relative, "utf8");

test("Policies use first-class FCT Status fixtures rather than a regex facet value", () => {
  const tree = featureFctQuery({ name: "query", attributes: {}, children: [] }, "policies",
    "urn:test:approvals", "https://example.org/sparql", 30);
  assert.deepEqual(tree.children.filter(node => node.name === "status"), []);
  assert.ok(!tree.children.some(node => node.name === "property" && node.attributes.iri === `${MUI}status`));
  assert.ok(!tree.children.some(node => node.name === "value" && node.attributes.op === "regex"));
  assert.ok(tree.children.some(node => node.name === "class" && node.attributes.iri === `${MUI}ClassPolicy`));
});

const statusContext = { liveEndpoint:"https://example.org/sparql", executionEndpoint:"https://example.org/sparql",
  defaultStatusAddr:"urn:test:record-status@https://example.org/sparql" };
const compileStatuses = (values: string[]) => compileFctXmlToSparql(
  `<query xmlns="http://openlinksw.com/services/facets/1.0" addr="urn:test:approvals@https://example.org/sparql">
    ${values.map(value => `<status type="uri" addr="urn:test:record-status@https://example.org/sparql">${value}</status>`).join("\n")}
    <view type="list" limit="30" offset="0"/></query>`, undefined, false, false, false, false, statusContext).query;

test("Pending and Approved compile as FCT alternatives in the status graph", () => {
  const sql = compileStatuses([`${MUI}Pending`, `${MUI}Approved`]);
  assert.match(sql, /GRAPH <urn:test:record-status>/);
  assert.match(sql, /UNION/);
  assert.ok(sql.includes(`<${MUI}status> <${MUI}Pending>`));
  assert.ok(sql.includes(`<${MUI}status> <${MUI}Approved>`));
  assert.match(sql, /GRAPH <urn:test:approvals>/);
});

test("FCT status compilation maps New to Unseen and preserves Hidden", () => {
  const sql = compileStatuses([`${MUI}New`, `${MUI}Hidden`]);
  assert.match(sql, /GRAPH <urn:test:record-status>/);
  assert.match(sql, /UNION/);
  assert.ok(sql.includes(`<${MUI}status> <${MUI}Unseen>`));
  assert.ok(sql.includes(`<${MUI}status> <${MUI}Hidden>`));
  assert.ok(!sql.includes(`<${MUI}status> <${MUI}New>`));
});

test("FCT count-distinct compiles without a post-serialization SPARQL rewrite", () => {
  const compiled = compileFctXmlToSparql('<query addr="@https://example.org/sparql"><class iri="urn:test:Class"/><view type="count-distinct"/></query>');
  assert.equal(compiled.view, "count-distinct");
  assert.equal(compiled.countOnly, true);
  assert.match(compiled.query, /COUNT\(DISTINCT/);
});

test("Status projections are derived from independently verified bookmark XML", () => {
  const code = read("src/app/proxy/api/fct/route.ts");
  assert.match(code, /verifyApprovalBookmark\(bookmarkQueryXml, request\)/);
  assert.match(code, /cloneFctListStatusView\(bookmarkQueryXml\)/);
  assert.match(code, /compileFctXmlToSparql\(statusViewXml, undefined, false, false, false, false,/);
});

test("Statuses render through the common fixture and Bookmark animates its glyph only", () => {
  const widget = read("src/canvas/left/status-widget.tsx");
  const pane = read("src/canvas/left/filter-pane.tsx");
  const bar = read("src/canvas/top/appbar-pane.tsx");
  assert.match(widget, /function StatusFacetWidget/);
  assert.match(widget, /function LiveQueryStatusWidget/);
  assert.match(pane, /<LiveQueryStatusWidget/);
  assert.match(bar, /className=\{isQueryBookmarked \? "fill-current text-amber-500" : bookmarkBounce && policyBookmarkVisible \? "text-amber-500"/);
  assert.ok(!bar.includes('animate-bounce ring-2 ring-amber-400'));
});

test("Numeric literal evidence discovers a pending policy without bypassing approval", () => {
  const endpoint = read("src/app/proxy/api/service/handlers/personal-facet-providers.ts");
  const card = read("src/canvas/left/personal-widget-cards.tsx");
  assert.match(endpoint, /discoverPolicyApprovals\(/);
  assert.match(endpoint, /isCoercibleNumericLexical/);
  assert.match(endpoint, /approved\.has\(provider\.uri\)/);
  assert.match(card, /isCoercibleNumericLexical\(value\.uri\)/);
  assert.ok(isCoercibleNumericLexical("-12.5"));
  assert.ok(isCoercibleNumericLexical("1.5e-3"));
  assert.ok(!isCoercibleNumericLexical("+05:30"));
});
