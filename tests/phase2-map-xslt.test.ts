import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Parser, Store } from "n3";
import { XMLValidator } from "fast-xml-parser";
import { splitCompiledSelect } from "../src/lib/provider-fct-context";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const mui = "gttp://ggg.maestro.ecosys/ns/ui#";
const sh = "http://www.w3.org/ns/shacl#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const map = "gttp://ggg.maestro.ui/provider/map";

test("Map geo query, coordinate and palette definitions live in RDF/XSLT, not TS query constants", () => {
  const source = read("graph/map/provider.ttl");
  const store = new Store(new Parser().parse(source));
  const provider = store.getQuads(map, null, null, null);
  assert.equal(store.getQuads(map, `${mui}perspectiveKind`, null, null).length, 0);
  const shape = store.getQuads(map, `${mui}accepts`, null, null)[0]?.object;
  assert.ok(shape);
  const templates = ["queryTemplate", "resultTemplate", "paletteTemplate"] as const;
  const files = ["geographic-query.xsl", "coordinates.xsl", "palette.xsl"];
  for (const [index, property] of templates.entries()) {
    const resource = provider.find(quad => quad.predicate.value === mui + property)?.object;
    assert.ok(resource, `missing ${property}`);
    const literal = store.getQuads(resource, `${mui}templateContent`, null, null)[0]?.object.value;
    assert.equal(literal, read("graph/map/" + files[index]).trim(), `RDF/stylesheet mismatch for ${property}`);
    assert.equal(XMLValidator.validate(literal!), true, `invalid ${files[index]}`);
  }
  const choices = store.getQuads(shape, `${sh}or`, null, null)[0]?.object;
  assert.ok(choices);
  let node = choices;
  const bindings = new Set<string>();
  let branches = 0;
  while (node.termType === "BlankNode") {
    branches++;
    const item = store.getQuads(node, `${rdf}first`, null, null)[0]?.object;
    assert.ok(item);
    const paths = store.getQuads(item, `${sh}property`, null, null);
    assert.ok(paths.length);
    for (const path of paths) {
      const binding = store.getQuads(path.object, `${mui}mapBinding`, null, null)[0]?.object.value;
      assert.ok(binding && ["lat", "lng", "point", "wkt"].includes(binding));
      assert.ok(store.getQuads(path.object, `${sh}path`, null, null).length);
      bindings.add(binding);
    }
    node = store.getQuads(node, `${rdf}rest`, null, null)[0]?.object;
    assert.ok(node);
    assert.ok(branches <= 20, "cyclic or oversized SHACL list");
  }
  assert.equal(branches, 7);
  assert.deepEqual([...bindings].sort(), ["lat", "lng", "point", "wkt"]);
  assert.equal(
    existsSync(join(process.cwd(), "src/providers/map/query.ts")),
    false,
    "obsolete Map-specific query.ts must remain removed after the XSLT UI cutover",
  );
});

test("generic FCT outer SELECT extraction preserves nested SPARQL, literals and directives", () => {
  const compiled = `DEFINE input:inference 'urn:test'\nSELECT DISTINCT ?c1 WHERE {\n ?c1 <http://example.org/a> 'contains } braces' .\n { SELECT ?other WHERE { ?other <http://example.org/p> ?c1 . } }\n FILTER(STR(?c1) != "{literal}")\n} LIMIT 30`;
  const result = splitCompiledSelect(compiled);
  assert.ok(result.prefix.includes("DEFINE input:inference"));
  assert.ok(result.where.includes("contains } braces"));
  assert.ok(result.where.includes("{literal}"));
  assert.ok(result.where.includes("SELECT ?other"));
  assert.ok(!result.where.includes("LIMIT 30"));
});
