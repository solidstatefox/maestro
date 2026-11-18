# Maestro Phase 1 — v0.1.0 implementation and acceptance ledger

**Baseline:** user-provided `maestro 3(1).zip`. **Artifact:** changed/new files only, overlaid onto that baseline. This is a partial Phase 1 implementation, not a claim that every approved Phase 1 acceptance criterion has been satisfied in a live browser.

## Implemented source changes

- Preserved one authoritative FCT tree. Prevented asynchronous Group-by dropdown options from clearing the committed `group="true"` relationship, and reduced duplicate view paging/session snapshots.
- Added a request-scoped projection contract for arbitrary Group-by SPARQL result aliases, with count and response compatibility checks. The user-supplied six-sport/seven-resource fixture remains the intended acceptance test.
- Improved History/Bookmark readiness so the current query XML cannot be paired with an older History visit identifier, with an attempt to flush pending History writes before bookmarking.
- Corrected repeated-IRI Personal facet navigation by selecting the actual in-scope node, not the first ancestor having that predicate IRI.
- Added language preference handling with Sheet language as the saved default, a URL-only `lang` override, Add to Share URL and Remove controls, and refresh/request scoping for effective-language changes. Removed `indexLang` usage from the FCT view production paths and strips it from imported/serialized XML; retained explicit `xml:lang` constraints and existing RDF literal language rules.
- Aligned root “Everything” indicator with the committed FCT search state (`signal-zero`).
- Improved Map provider discovery: read SHACL RDF-list closure and check provider-specific geographic-query eligibility instead of treating general History validation as Map eligibility.
- Re-armed Perspective auto-selection on query changes and prevented selection from disappearing during an empty discovery refresh.
- Corrected Overview radial sweep to 360 degrees.
- Recorded Temporal provider resolution tab/selected calendar cell with committed `<value>` metadata and restored them from that value.
- Replaced one fragile SaxonJS Place Record link attribute expression that referenced an unbound `$predicate` variable.

## Validation completed in the patch workspace

- Seven focused Node test suites: **28 passing, 0 failing**.
- TypeScript/TSX source syntax parsing: **356 files**, no syntax errors.
- Changed RDF graph: **294 triples parsed**; Place XSLT document parsed as XML.
- Archive entries compared byte-for-byte with the uploaded baseline; no unchanged source files included.

## Not yet verified or incomplete

- A full `npm.cmd run build` could not be completed here without installed project dependencies. Run `npm.cmd ci` and `npm.cmd run build` in the user's Maestro working environment.
- The remaining Phase 1 acceptance goals require live Maestro/Virtuoso browser testing: Map pins for the latitude fixture, exclusion of Maps on Bookmarks, Group-by member cards/counters, bookmark persistence across History races, and Temporal/URL language restoration.
- The Record **“More about this place” missing values** issue has not been conclusively repaired; the stylesheet change addresses only the observed unbound-variable expression.
- The intermittent Tag Cloud and Bookmarks Perspective lifecycle regressions, maximum-update-depth feedback loops, full Overview count correctness, and all residual query ownership audits are not claimed fixed here.
- The new language URL control and source-of-truth changes require browser acceptance, including Back/Forward, share URLs and regional language tags; avoid treating source-level tests as end-to-end evidence.
- Updated RDF/XSLT stored in personal graphs requires reseeding/republication of the changed graph assets and confirmation that the personal graph contains the new policy version.

## Install and test

Apply the changed-files-only ZIP at the root of the **same** Maestro baseline, with extraction overwriting files. Then run the targeted Node suites, `npm.cmd run build`, and `npm.cmd run dev`. The XState development debug panel is available at `http://localhost:3000/?maestroLifecycle=1`.
