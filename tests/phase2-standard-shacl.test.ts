import test from "node:test";
import assert from "node:assert/strict";
import { validateStandardShaclRows } from "../src/lib/shacl-standard-validation";

const SH = "http://www.w3.org/ns/shacl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const shape = "urn:example:map-input";
const focus = "urn:example:alaska";
const latitude = "http://www.w3.org/2003/01/geo/wgs84_pos#lat";
const longitude = "http://www.w3.org/2003/01/geo/wgs84_pos#long";

type RdfBinding = { type: string; value: string; datatype?: string };
const uri = (value: string): RdfBinding => ({ type: "uri", value });
const blank = (value: string): RdfBinding => ({ type: "bnode", value });
const lit = (value: string): RdfBinding => ({ type: "literal", value, datatype: `${XSD}integer` });
function row(s: RdfBinding, p: string, o: RdfBinding) { return { s, p: uri(p), o }; }
const shapeRows = [
  row(uri(shape), `${RDF}type`, uri(`${SH}NodeShape`)),
  row(uri(shape), `${SH}property`, blank("lat")),
  row(uri(shape), `${SH}property`, blank("long")),
  row(blank("lat"), `${SH}path`, uri(latitude)),
  row(blank("lat"), `${SH}minCount`, lit("1")),
  row(blank("long"), `${SH}path`, uri(longitude)),
  row(blank("long"), `${SH}minCount`, lit("1")),
];

test("SHACL Core report validates the explicit focus, not an empty target set", async () => {
  const result = await validateStandardShaclRows(shape, focus, shapeRows, [
    { subject: focus, predicate: latitude, object: "64.2008", objectType: "literal" },
  ]);
  assert.equal(result.conforms, false);
  assert.equal(result.standard, "SHACL Core");
  assert.ok(result.violations.some(item => item.path === longitude));
  assert.match(result.reportNTriples, /ValidationReport/);
  assert.match(result.reportNTriples, /ValidationResult/);
  assert.match(result.reportXml, /<sh:ValidationReport/);
});

test("SHACL report conforms after both required coordinates are present", async () => {
  const result = await validateStandardShaclRows(shape, focus, shapeRows, [
    { subject: focus, predicate: latitude, object: "64.2008", objectType: "literal" },
    { subject: focus, predicate: longitude, object: "-149.4937", objectType: "literal" },
  ]);
  assert.equal(result.conforms, true);
  assert.equal(result.violations.length, 0);
  assert.match(result.reportNTriples, /conforms/);
});
