import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const graph = readFileSync(new URL("../graph/dbpedia/maestro-dbpedia-policies.ttl", import.meta.url), "utf8");

// Each rdf:value literal is a self-contained XSLT stylesheet. Named template
// calls must be resolvable inside that stylesheet, not merely in a sibling
// DBpedia formatter using the same QName and namespace.
test("all seeded DBpedia Record stylesheets define every called named template", () => {
  const sheets = [...graph.matchAll(/rdf:value\s+"""(<xsl:stylesheet[\s\S]*?<\/xsl:stylesheet>)"""/g)]
    .map(match => match[1]);
  assert.ok(sheets.length >= 7, "expected all DBpedia formatter stylesheets");
  for (const [index, sheet] of sheets.entries()) {
    const defined = new Set([...sheet.matchAll(/<xsl:template\s+name="([^"]+)"/g)].map(match => match[1]));
    const called = [...sheet.matchAll(/<xsl:call-template\s+name="([^"]+)"/g)].map(match => match[1]);
    for (const name of called) assert.ok(defined.has(name), `stylesheet ${index + 1} calls undefined ${name}`);
  }
});

test("Book formatter declares m:roles in the same stylesheet that calls it", () => {
  const book = graph.match(/<gttp:\/\/ggg\.maestro\.ecosys\/shacl\/template#DbpediaBookRecordTemplate>[\s\S]*?rdf:value\s+"""(<xsl:stylesheet[\s\S]*?<\/xsl:stylesheet>)"""/);
  assert.ok(book);
  assert.match(book[1], /<xsl:call-template name="m:roles"\/>/);
  assert.match(book[1], /<xsl:template name="m:roles">/);
  assert.match(book[1], /<xsl:for-each-group select="\$incoming"/);
});
