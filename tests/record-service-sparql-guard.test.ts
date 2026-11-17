import test from "node:test";
import assert from "node:assert/strict";
import { isBoundedReadOnlySparql } from "../src/lib/sparql-read-guard";

const serviceDiscovery = `PREFIX svc: <gttp://ggg.maestro.ecosys/ns/service#> PREFIX sh: <http://www.w3.org/ns/shacl#> PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  SELECT DISTINCT ?service ?label ?operation ?operationLabel ?requires WHERE {
    GRAPH <gttp://ggg.maestro.ecosys/user/shacl/policies> {
      VALUES ?class { <https://schema.org/Person> }
      ?service a svc:Service, sh:NodeShape ; sh:targetClass ?class ; rdfs:label ?label ; svc:operation ?operation .
      ?operation rdfs:label ?operationLabel ; svc:endpoint ?endpoint ; svc:method ?method .
      OPTIONAL { ?operation svc:requires ?requires }
    }
  } LIMIT 150`;

test("Record service SHACL discovery is an allowed bounded SELECT, not federation", () => {
  assert.equal(isBoundedReadOnlySparql(serviceDiscovery, 100000), true);
});

test("Read guard accepts variable names, prefixed names, IRIs and literal strings containing forbidden words", () => {
  assert.equal(isBoundedReadOnlySparql(`SELECT ?service ?load ?delete WHERE { ?service <urn:Service> svc:Service . BIND("SERVICE INSERT DELETE" AS ?delete) } LIMIT 1`, 100000), true);
  assert.equal(isBoundedReadOnlySparql("SELECT ?service WHERE { ?service ex:Load ex:Delete } LIMIT 1", 100000), true);
});

test("Read guard still rejects actual SERVICE federation and SPARQL updates", () => {
  assert.equal(isBoundedReadOnlySparql("SELECT * WHERE { SERVICE <https://example.org/sparql> { ?s ?p ?o } } LIMIT 1", 100000), false);
  assert.equal(isBoundedReadOnlySparql("SELECT * WHERE { SERVICE SILENT <https://example.org/sparql> { ?s ?p ?o } } LIMIT 1", 100000), false);
  assert.equal(isBoundedReadOnlySparql("SELECT ?s WHERE { ?s ?p ?o } INSERT { ?s ?p ?o } LIMIT 1", 100000), false);
  assert.equal(isBoundedReadOnlySparql("DELETE WHERE { GRAPH <urn:g> { ?s ?p ?o } }", 100000), false);
});

test("Read guard retains the existing SELECT/ASK and maximum-size requirements", () => {
  assert.equal(isBoundedReadOnlySparql("ASK WHERE { ?s ?p ?o }", 100), true);
  assert.equal(isBoundedReadOnlySparql(serviceDiscovery, 20), false);
  assert.equal(isBoundedReadOnlySparql("CONSTRUCT WHERE { ?s ?p ?o }", 100), false);
  assert.equal(isBoundedReadOnlySparql("", 100), false);
});
