"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const xsl = read("graph/eu-data/record.xsl");
const ttl = read("graph/eu-data/provider.ttl");
const pages = read("src/components/ui/record-value-pages.tsx");
const bridge = read("src/components/maestro-xslt-components.tsx");

test("EURIO Project uses explicit domain labels and retains original RDF predicates", () => {
  for (const name of ["Cost", "Funding", "Research fields", "EU contribution", "Project ID", "CORDIS RCN", "Signature date"]) {
    assert.ok(xsl.includes(`'${name}'`), `missing hardcoded domain label ${name}`);
  }
  assert.match(xsl, /name="fmt:property-label"[\s\S]*?<xsl:choose>/);
  assert.match(xsl, /name="label" select="fmt:property-label\(\$iri\)"/);
  assert.match(xsl, /data-maestro-predicate="\{\$iri\}"/);
  assert.match(xsl, /resource="\{\$value\}"/);
});

test("participant rows are full-width, one line, and do not repeat the Participants header", () => {
  assert.match(xsl, /<ul id="eu-project-participants-list"/);
  assert.match(xsl, /<li id="eu-project-participant-\{position\(\)\}"/);
  assert.match(xsl, /name="project-involved-party"/);
  assert.doesNotMatch(xsl, /id="eu-project-participants-list"[^>]*overflow-x-auto/);
  assert.match(xsl, /data-maestro-preserve-formatted-label="true"/);
});

test("Results follow narrative in their own section, with 5 / 10 / 20 pagination", () => {
  const narrative = xsl.indexOf('id="eu-project-narrative"');
  const abstracts = xsl.indexOf('select="$abstractRows"', narrative);
  const descriptions = xsl.indexOf('select="$descriptionRows"', narrative);
  const extra = xsl.indexOf('select="$additionalLongTextRows"', narrative);
  const results = xsl.indexOf('id="eu-project-results"', narrative);
  const details = xsl.indexOf('id="eu-project-details"', narrative);
  assert.ok(narrative >= 0 && abstracts > narrative && descriptions > abstracts && extra > descriptions && results > extra && details > results);
  assert.ok(results > xsl.indexOf('</section>', narrative), "Results must be outside narrative in their own section");
  assert.match(xsl, /<section id="eu-project-results-section"/);
  assert.match(xsl, /<h3 id="eu-project-results-title"[^>]*>Deliverables<\/h3>/);
  assert.match(xsl, /<RecordValuePages id="eu-project-results-list" pageSize="5" maxPageSize="20" pageSizeSelect="true" listTag="ol"/);
  assert.match(xsl, /<\/RecordValuePages>/);
  assert.match(xsl, /id="eu-project-result-link-\{\$n\}"[^>]+rel="\{\$resultPredicate\}" resource="\{\$resultUri\}"/);
  assert.match(xsl, /id="eu-project-doi-link-\{\$n\}"/);
  assert.match(pages, /const choices = \[5, 10, 20\]\.filter/);
  assert.match(pages, /Math\.min\(cap, Math\.floor\(pageSize\)\)/);
  assert.match(pages, /setPage\(Math\.floor\(start \/ selected\)\)/);
  assert.match(pages, /<MaestroSelect id=\{`\$\{id \?\? "record"\}-page-size`\} aria-label="Results per page"/);
  assert.match(pages, /<Button type="button" variant="outline" size="icon-sm"/);
  assert.match(pages, /Page \{current \+ 1\} of \{pages\}/);
  assert.match(pages, /const ListContainer = isResultList \? "ol" : "div"/);
  for (const key of ["maxpagesize", "pagesizeselect", "listtag", "listclassname"]) assert.ok(bridge.includes(`${key}:`));
  assert.match(bridge, /"maxPageSize"/);
  assert.match(bridge, /"pageSizeSelect"/);
});

test("terminated projects display red progress and one red endpoint pin if duration overlaps", () => {
  assert.match(xsl, /name="isTerminated" select="\$statusCode = 'TERMINATED' or \$hasTermination"/);
  assert.match(xsl, /name="isOngoing" select="not\(\$statusCode = 'CLOSED' or \$isTerminated\)"/);
  assert.match(xsl, /id="eu-project-track-fill"[^>]+if \(\$isTerminated\) then 'bg-red-500\/85'/);
  assert.match(xsl, /name="terminationPinPosition" select="if \(\$hasTermination\) then \$terminationPosition else 100"/);
  assert.match(xsl, /name="coincidentPins"[\s\S]*?abs\(\$durationPosition - \$terminationPinPosition\) lt 0\.5/);
  assert.match(xsl, /<xsl:if test="\$durationRow and not\(\$coincidentPins\)">/);
  assert.match(xsl, /id="eu-project-termination-dot"[^>]+bg-red-600/);
  assert.match(xsl, /A separate termination date was not provided/);
});

test("plain-language administrative status replaces technical legends", () => {
  assert.match(xsl, /CORDIS says this project was stopped rather than completed normally/);
  assert.match(xsl, /CORDIS records this project as closed/);
  assert.match(xsl, /The funding agreement has been signed/);
  assert.doesNotMatch(xsl, /Blue: elapsed|muted: remaining scheduled duration|duration and end date are recorded project fields/);
});

test("the RDF Record implementation contains the exact production stylesheet", () => {
  const embedded = `mui:templateContent """${xsl.replace(/\\/g, "\\\\")} """`.replace(/ """$/, '"""');
  assert.equal(ttl.split(embedded).length - 1, 1);
});
