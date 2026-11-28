import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { predicateAnalyticsUpstreamFailure, predicateAnalyticsEndpointWithTimeout } from "../src/lib/predicate-analytics-upstream";

test("HTTP 206 and complete Virtuoso JSON/body/headers survive the FCT proxy intact", async () => {
  const body = JSON.stringify({head:{vars:["c1"]},results:{bindings:[{c1:{type:"uri",value:"urn:p:test"}}]},
    note: "partial <row> & SELECT '\" hello"}) + "\n" + "x".repeat(800);
  const response = new Response(body,{status:206,statusText:"Partial Content",headers:{
    "Content-Type":"application/sparql-results+json", "X-SQL-State":"S1TAT",
    "X-SQL-Message":"Returning incomplete results, query interrupted by result timeout",
    "X-Exec-Milliseconds":"20000", "X-Test-Detail":"keep <all> & values",
    "Set-Cookie":"secret=do-not-expose",
  }});
  const error = predicateAnalyticsUpstreamFailure({phase:"candidates",response,body,
    query:"SELECT DISTINCT ?p WHERE { ?s ?p ?o }",endpoint:"https://example.org/sparql"});
  const forwarded = error.toResponse();
  assert.equal(forwarded.status,206);
  assert.equal(forwarded.headers.get("x-maestro-upstream-status"),"206");
  assert.equal(forwarded.headers.get("x-maestro-incomplete"),"true");
  const xml = await forwarded.text();
  assert.match(xml,/<fct:complete>no<\/fct:complete>/);
  assert.match(xml,/S1TAT/);
  assert.match(xml,/Returning incomplete results/);
  assert.match(xml,/<fct:header name="x-test-detail">keep &lt;all&gt; &amp; values<\/fct:header>/);
  assert.match(xml,/SELECT DISTINCT \?p/);
  assert.doesNotMatch(xml,/secret=do-not-expose/);
  assert.ok(xml.length>800, "diagnostic body must never be truncated to 300 characters");
  const encoded = xml.match(/<fct:body-base64[^>]*>([^<]*)<\/fct:body-base64>/)?.[1];
  assert.ok(encoded);
  assert.equal(Buffer.from(encoded,"base64").toString("utf8"),body);
});

test("Virtuoso HTTP 500 and 401 retain their original status and response details", async () => {
  for (const status of [401,500]) {
    const body = `Virtuoso fatal SQL error \"SQ074\" <diagnostic> status ${status}`;
    const upstream = new Response(body,{status,headers:{"X-SQL-Message":"SQ074: invalid query"}});
    const forwarded = predicateAnalyticsUpstreamFailure({phase:"counts",response:upstream,body,
      query:"SELECT ?c1 ?n WHERE { ... }",endpoint:"https://example.org/sparql"}).toResponse();
    assert.equal(forwarded.status,status);
    const xml=await forwarded.text();
    assert.match(xml,/SQ074: invalid query/);
    assert.match(xml,/<fct:body>Virtuoso fatal SQL error/);
    assert.match(xml,new RegExp(`status ${status}`));
  }
});

test("invalid upstream HTTP 200 can be rejected as proxy 502 without losing HTTP 200 provenance", async () => {
  const upstream = new Response("<html>broken & partial</html>",{status:200});
  const forwarded = predicateAnalyticsUpstreamFailure({phase:"counts",response:upstream,
    body:"<html>broken & partial</html>",query:"SELECT ...",endpoint:"https://example.org/sparql",
    proxyStatus:502,explanation:"Invalid SPARQL Results JSON returned by Virtuoso"}).toResponse();
  assert.equal(forwarded.status,502);
  assert.equal(forwarded.headers.get("x-maestro-upstream-status"),"200");
  assert.match(await forwarded.text(),/Invalid SPARQL Results JSON returned by Virtuoso/);
});

test("full response diagnostics are not truncated, but secrets are redacted", async () => {
  const body = "Virtuoso error: Authorization: Bearer abcdefghijklmnop\n" + "details".repeat(500);
  const upstream = new Response(body,{status:400,headers:{"X-SQL-Message":"Bearer abcdefghijklmnop"}});
  const forwarded = predicateAnalyticsUpstreamFailure({phase:"overlaps",response:upstream,body,
    query:"SELECT ...",endpoint:"https://example.org/sparql"}).toResponse();
  const xml = await forwarded.text();
  assert.match(xml,/REDACTED/);
  assert.doesNotMatch(xml,/abcdefghijklmnop/);
  assert.match(xml,/detailsdetailsdetails/);
  const encoded = xml.match(/<fct:body-base64[^>]*>([^<]*)<\/fct:body-base64>/)?.[1];
  assert.ok(encoded);
  assert.doesNotMatch(Buffer.from(encoded,"base64").toString("utf8"),/abcdefghijklmnop/);
});


test("Predicate Clusters timeout reaches Virtuoso in the URL, preserving endpoint params", () => {
  assert.equal(predicateAnalyticsEndpointWithTimeout("https://dbpedia.org/sparql",120000),
    "https://dbpedia.org/sparql?timeout=120000");
  const original = "https://example.org/sparql?default-graph-uri=urn%3Ag&timeout=10000";
  const changed = new URL(predicateAnalyticsEndpointWithTimeout(original,240000));
  assert.equal(changed.searchParams.get("timeout"),"240000");
  assert.equal(changed.searchParams.get("default-graph-uri"),"urn:g");
  assert.equal(changed.searchParams.getAll("timeout").length,1);
  assert.equal(predicateAnalyticsEndpointWithTimeout(original,0),original);
  assert.equal(predicateAnalyticsEndpointWithTimeout(original,999),original);
});

test("Anytime diagnostics preserve the upstream endpoint's requested timeout", async () => {
  const endpoint = predicateAnalyticsEndpointWithTimeout("https://dbpedia.org/sparql",120000);
  const response = new Response("{\"head\":{}}", {status:206,headers:{
    "X-SPARQL-Anytime":"timeout=10000; max_timeout=120000", "X-SQL-State":"S1TAT"}});
  const failure = predicateAnalyticsUpstreamFailure({phase:"counts",response,
    body:"{\"head\":{}}",query:"SELECT ...",endpoint}).toResponse();
  assert.equal(failure.status,206,"incomplete counts are never treated as usable");
  const xml = await failure.text();
  assert.match(xml,/endpoint="https:\/\/dbpedia\.org\/sparql\?timeout=120000"/);
  assert.match(xml,/timeout=10000; max_timeout=120000/);
  assert.match(xml,/<fct:complete>no<\/fct:complete>/);
});
