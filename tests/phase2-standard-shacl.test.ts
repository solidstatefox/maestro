import test from "node:test";
import assert from "node:assert/strict";
import { validateStandardShaclRows } from "../src/lib/shacl-standard-validation";
import { validateClientShaclRows } from "../src/lib/client-record-shacl";

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

test("Record SHACL preserves the Unicode India incoming subject, object, predicate and datatype", async () => {
  const subject = "http://dbpedia.org/resource/K.K._Gopalakrishnan__K.\u202fK.\u202fGopalakrishnan__1";
  const india = "http://dbpedia.org/resource/India";
  const predicate = "urn:test:p\u202f1";
  const datatype = "urn:test:datatype\u202f1";
  const testShape = "urn:test:unicode-shape";
  const rows = [
    row(uri(testShape), `${RDF}type`, uri(`${SH}NodeShape`)),
    row(uri(testShape), `${SH}property`, blank("related")),
    row(blank("related"), `${SH}path`, uri(predicate)),
    row(blank("related"), `${SH}hasValue`, uri(subject)),
    row(uri(testShape), `${SH}property`, blank("incoming")),
    row(blank("incoming"), `${SH}path`, blank("inverseBirth")),
    row(blank("inverseBirth"), `${SH}inversePath`, uri("http://dbpedia.org/ontology/birthPlace")),
    row(blank("incoming"), `${SH}hasValue`, uri(subject)),
    row(uri(testShape), `${SH}property`, blank("typed")),
    row(blank("typed"), `${SH}path`, uri("urn:test:typed")),
    row(blank("typed"), `${SH}hasValue`, { type: "literal", value: "x", datatype }),
  ];
  const triples = [
    { subject, subjectType: "uri" as const, predicate: "http://dbpedia.org/ontology/birthPlace", object: india, objectType: "uri" },
    { subject: india, subjectType: "uri" as const, predicate, object: subject, objectType: "uri" },
    { subject: india, subjectType: "uri" as const, predicate: "urn:test:typed", object: "x", objectType: "literal", datatype },
  ];
  for (const validate of [validateStandardShaclRows, validateClientShaclRows]) {
    const result = await validate(testShape, india, rows, triples);
    assert.equal(result.conforms, true);
    await assert.rejects(validate(testShape, india, rows, [{ ...triples[2], datatype: "urn:bad datatype" }]), /Invalid RDF datatype IRI/);
  }
});
