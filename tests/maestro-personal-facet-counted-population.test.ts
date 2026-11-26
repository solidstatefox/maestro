import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFctXmlToSparql } from "../src/lib/fct-sparql-translator";
import { computeClientCacheKey } from "../src/lib/client-query-cache";

// Reproduce the user's bookmark label facet: the Results and counted LIST
// differ only in projection, aggregation and final pagination.
const bookmarkXml = (view: string, order = "", offset = 0) => `<query xmlns="http://openlinksw.com/services/facets/1.0" inference="" same-as="" timeout="20000" addr="http://demo.openlinksw.com/ods/home/acme/query#bookmarks@http://demo.openlinksw.com/sparql" id="a" ctr="18" uctr="a" rctr="c"${order ? ` order="${order}"` : ""}>
  <class iri="http://www.w3.org/2002/01/bookmark#Bookmark" id="d"/>
  <property iri="http://www.w3.org/2004/02/skos/core#prefLabel" rid="a" id="f">
    <view ${view} limit="30" offset="${offset}" id="e"/>
  </property>
  <property iri="http://purl.org/dc/terms/created" rid="b" id="g">
    <value rangeStart="2026-11-25T00:00:00Z" rangeEnd="2026-11-25T23:59:59Z" uiResolution="weeks" uiCell="day:2026-11-25" datatype="dateTime" id="h"/>
  </property>
</query>`;
const compile = (xml: string) => compileFctXmlToSparql(xml, undefined, false, false, false, false, undefined, "en");
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

test("bookmark counted LIST wraps the exact Results population and preserves the c1/ct contract", () => {
  const results = compile(bookmarkXml('type="text"'));
  const facet = compile(bookmarkXml('type="list" sort="count"'));
  const population = results.query.slice(0, results.query.lastIndexOf("\nLIMIT"));
  const expected = `SELECT ?c1 (COUNT(*) AS ?ct) WHERE { { ${population.replace("SELECT DISTINCT (?s2 AS ?c1)", "SELECT DISTINCT (?s2 AS ?c1) ?s1")} } } GROUP BY ?c1 LIMIT 30 OFFSET 0`;
  assert.equal(normalize(facet.query), normalize(expected));
  assert.equal(facet.target, results.target);
  assert.equal(facet.timeoutMs, 20000);
  assert.equal(facet.view, "list");
  assert.doesNotMatch(facet.query, /COUNT\(DISTINCT|GROUP BY \?s2|ORDER BY/);
});

test("counted LIST sorts only after aggregation when root ordering is enabled; paging never truncates the inner population", () => {
  const { query } = compile(bookmarkXml('type="list" sort="count"', "yes", 30));
  assert.match(query, /GROUP BY \?c1\nORDER BY DESC \(\?ct\) ASC \(STR\(\?c1\)\)\nLIMIT 30\nOFFSET 30$/);
  assert.equal((query.match(/\bLIMIT\b/g) ?? []).length, 1);
  assert.equal((query.match(/\bOFFSET\b/g) ?? []).length, 1);
  assert.equal((query.match(/\bORDER BY\b/g) ?? []).length, 1);
});

test("ordinary LIST and legacy LIST_COUNT retain their own projection contracts", () => {
  const list = compile(bookmarkXml('type="list"')).query;
  const results = compile(bookmarkXml('type="text"')).query;
  assert.equal(list, results);
  const count = compile(bookmarkXml('type="list-count" sort="count"')).query;
  assert.match(count, /^SELECT \(\?s2 AS \?c1\)\s+\(COUNT\(\*\) AS \?n\)/);
  assert.match(count, /GROUP BY \?s2/);
  assert.doesNotMatch(count, /SELECT DISTINCT/);
});

test("federated status conditions belong to the unpaginated distinct population exactly once", () => {
  const xml = bookmarkXml('type="list" sort="count"').replace("</query>", '<status type="uri" addr="urn:test:status@https://example.org/sparql">gttp://ggg.maestro.ecosys/ns/ui#Approved</status></query>');
  const { query } = compileFctXmlToSparql(xml, undefined, false, false, false, false, {
    liveEndpoint: "http://demo.openlinksw.com/sparql",
    executionEndpoint: "https://example.org/sparql",
    defaultStatusAddr: "urn:test:status@https://example.org/sparql",
  }, "en");
  assert.match(query, /^SELECT \?c1\s+\(COUNT\(\*\) AS \?ct\)\nWHERE \{\n  \{\n    SELECT DISTINCT/);
  const inner = query.slice(query.indexOf("SELECT DISTINCT"), query.indexOf("GROUP BY ?c1"));
  assert.match(inner, /SERVICE <http:\/\/demo\.openlinksw\.com\/sparql>/);
  assert.match(inner, /GRAPH <urn:test:status>/);
  assert.match(inner, /<gttp:\/\/ggg\.maestro\.ecosys\/ns\/ui#Approved>/);
  assert.equal((query.match(/GRAPH <urn:test:status>/g) ?? []).length, 1);
});

test("the corrected FCT result namespace cannot replay pre-fix grouped responses", () => {
  const body = bookmarkXml('type="list" sort="count"').replace(/http:\/\/demo\.openlinksw\.com\/ods\/home\/acme\/query#bookmarks/g, "urn:test:bookmarks");
  const key = computeClientCacheKey("/proxy/api/fct", { method: "POST", body });
  assert.match(key ?? "", /fct-labels-v4::anytime-v1::counted-population-v1::/);
  assert.match(readFileSync("src/app/proxy/api/fct/route.ts", "utf8"), /fct-response-page-labels-v2-anytime-v1-counted-population-v1/);
  assert.doesNotMatch(computeClientCacheKey("/proxy/api/sparql", { method: "POST", body: '{"query":"SELECT * WHERE {}"}' }) ?? "", /counted-population/);
});
