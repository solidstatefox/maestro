"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const base = path.resolve(__dirname, "..");
const xsl = fs.readFileSync(path.join(base, "graph/eu-data/record.xsl"), "utf8");
const provider = fs.readFileSync(path.join(base, "graph/eu-data/provider.ttl"), "utf8");
const workspace = fs.readFileSync(path.join(base, "src/canvas/utils/workspace-controller.tsx"), "utf8");

test("the Record Project standalone stylesheet and both embedded RDF stylesheets are identical", () => {
  const embedded = `mui:templateContent """${xsl.replace(/\\/g, "\\\\")}"""`;
  assert.equal(provider.split(embedded).length - 1, 2);
});

test("the status-colored rail and class banner styling remain unchanged", () => {
  assert.match(xsl, /id="eu-project-status-rail"/);
  assert.match(xsl, /id="eu-project-eyebrow"/);
  assert.match(xsl, /id="eu-project-status-icon"/);
  assert.match(xsl, /bg-green-600 dark:bg-green-400/);
  assert.match(xsl, /bg-red-600 dark:bg-red-400/);
});

test("the domain formatter labels Project properties without querying the ontology", () => {
  assert.match(xsl, /name="fmt:property-label"/);
  for (const name of ["Cost", "Funded by", "Research fields", "EU contribution", "CORDIS RCN", "Project ID", "Signature date"]) {
    assert.ok(xsl.includes(`'${name}'`), `missing label ${name}`);
  }
  assert.match(xsl, /name="label" select="fmt:property-label\(\$iri\)"/);
});

test("European Cost and parsed participants use existing URI column labels and preserve RDF identities", () => {
  assert.match(xsl, /decimal-separator="," grouping-separator="\."/);
  assert.match(xsl, /name="project-monetary"/);
  assert.match(xsl, /format-number\(xs:decimal\(\$amount\),'#\.##0,##','eu'\)/);
  assert.match(xsl, /id="\{\$id\}-currency-icon"/);
  assert.match(xsl, /name="project-involved-party"/);
  assert.match(xsl, /substring-after\(\$raw, 'Org:'\)/);
  assert.match(xsl, /substring-after\(\$raw, 'Role:'\)/);
  assert.match(xsl, /substring-after\(\$raw,'Project:'\)/);
  assert.match(xsl, /<ul id="eu-project-participants-list"/);
  assert.match(xsl, /<li id="eu-project-participant-\{position\(\)\}"/);
  assert.match(xsl, /<xsl:call-template name="project-involved-party">/);
  assert.match(xsl, /class="min-w-0 flex-1 break-words text-sm text-primary hover:underline"/);
  assert.doesNotMatch(xsl, /id="eu-project-participants-list" class="grid/);
  assert.match(xsl, /data-maestro-preserve-formatted-label="true"/);
});

test("acronym is parsed from its URI label and title uses the resource URL when present", () => {
  assert.match(xsl, /name="acronymRaw"/);
  assert.match(xsl, /name="acronym"/);
  assert.match(xsl, /\^Acronym:/);
  assert.match(xsl, /\[\/#\]url\$/);
  assert.match(xsl, /id="eu-project-title-link" data-maestro-external-link="true"/);
});

test("Results are immediately after the narrative, with a third-column DOI document link", () => {
  const narrative = xsl.indexOf('id="eu-project-narrative"');
  const results = xsl.indexOf('id="eu-project-results"');
  const details = xsl.indexOf('id="eu-project-details"');
  assert.ok(narrative >= 0 && narrative < results && results < details);
  assert.ok(results > xsl.indexOf('</section>', narrative), 'Results must be an independent section after narrative');
  assert.match(xsl, /id="eu-project-results"[^>]*role="region"/);
  assert.match(xsl, /exists\(\$resultRows\)/);
  assert.match(xsl, /select="\$additionalLongTextRows"/);
  assert.doesNotMatch(xsl, /Blue: elapsed · muted: remaining scheduled duration/);
  assert.match(xsl, /grid-cols-\[1\.75rem_minmax\(0,1fr\)_1\.75rem\]/);
  assert.match(xsl, /id="eu-project-doi-link-\{\$n\}"/);
  assert.match(xsl, /https:\/\/doi\.org\//);
  assert.match(xsl, /id="eu-project-doi-icon-\{\$n\}"/);
  assert.match(xsl, /<RecordValuePages id="eu-project-results-list" pageSize="5" maxPageSize="20" pageSizeSelect="true" listTag="ol"/);
  assert.match(xsl, /<\/RecordValuePages>/);
  assert.doesNotMatch(xsl, /<ol id="eu-project-results-list"/);
  assert.doesNotMatch(xsl, /Blue: elapsed/);
});

test("termination date uses a red marker and elapsed bar without altering normal blue duration", () => {
  assert.match(xsl, /terminationdate\$/);
  assert.match(xsl, /id="eu-project-termination-marker"/);
  assert.match(xsl, /id="eu-project-track-fill"/);
  assert.match(xsl, /if \(\$isTerminated\) then 'bg-red-500\/85'/);
  assert.match(xsl, /id="eu-project-duration-marker"/);
  assert.match(xsl, /name="isTerminated" select="\$statusCode = 'TERMINATED' or \$hasTermination"/);
  assert.match(xsl, /name="coincidentPins"/);
  assert.match(xsl, /\$durationRow and not\(\$coincidentPins\)/);
  assert.match(xsl, /id="eu-project-status-explanation"/);
  assert.match(xsl, /CORDIS says this project was stopped rather than completed normally/);
  assert.match(xsl, /funding agreement has been signed/);
  assert.doesNotMatch(xsl, /duration and end date are recorded project fields/);
});

test("XSLT uses the existing Record label cache, and late labels rerender locally", () => {
  assert.match(workspace, /recordPreparedFormatXmlRef/);
  assert.match(workspace, /recordPreparedTemplateRef/);
  assert.match(workspace, /object\.setAttribute\("label", label\)/);
  assert.match(workspace, /labelsOnly \? preparedTemplate!\.payload : await loadClientPolicyTemplate/);
  assert.match(workspace, /formatSelectedRecord\(undefined, false, false, true\)/);
  assert.match(workspace, /target\.getAttribute\("data-maestro-preserve-formatted-label"\) !== "true"/);
  assert.match(workspace, /element\.dataset\.maestroPreserveFormattedLabel === "true"/);
  assert.match(workspace, /\[data-maestro-external-link\]/);
});
