# Maestro Phase 1 v0.2.0 — incremental source correction and acceptance ledger

**Required baseline:** `maestro 3(1).zip` with `maestro_phase1_v0.1.0_changed_files.zip` already applied. **Deliverable:** changed/new files only relative to that combined baseline. This is an incremental **Phase 1 follow-up**, not a claim that every Phase 1 acceptance goal is now complete.

## Source corrections implemented in v0.2.0

1. **Group-by heading values and counts:** The derived Group-by request is once again the same FCT facet-value enumeration as the matching Personal property, reverse-role, or Categories facet. The existing live `group="true"` marker and unchanged `<view>` focus are retained. Native grouped LIST compilation continues to exist for other uses; it is not needed for the displayed group headings.
2. **Group-by response decoder:** Removed the SPARQL-text/regex `groupProjectionContract` interpretation. The now-facet-equivalent FCT response is decoded through the typed two-column FCT facet response contract, with count validation, independent of SPARQL projection aliases. A failed refresh no longer empties previously accepted group values. Requests remain abortable through the existing query-scoped fetch pipeline.
3. **Center pane restoration:** When a committed query has an active `group="true"`, Browse Results transitions to Groups automatically, including restored URLs/History; removing grouping switches Groups back to Results. Code/Chat selections are not forcibly overwritten.
4. **Return from Bookmarks to Providers:** The XState navigation actor may capture the exact current non-Browse query/share URL when a provider replaces it and no prior Browse Return owner exists. It retains Browse priority, does not replace an established Return snapshot on provider-to-provider transitions, and restores the recorded View/Browse/Analyze tab and ribbon/endpoint instead of always forcing Browse.
5. **XSLT SVG / React DOM attributes:** Normalizes dashed SVG attributes (`stroke-width`, `stroke-linecap`, `stroke-linejoin` and related common SVG attributes) at the XSLT-to-React host. RDF/XSLT's serialized SVG remains unchanged.
6. **Place Record values host:** Loads the lightweight `RecordValuePages` React component synchronously in XSLT portals rather than waiting for an asynchronous registry import after the original DOM children are removed. This is a source correction for a possible blank-value window, **not** a confirmed runtime resolution of the missing Place values.

## Validation performed

- TypeScript/TSX syntax parsing of the complete repository through the project regression suite (passes).
- Focused Node tests for typed 6-sport / 7-resource Group-by rows, no SPARQL regex dependency, group mode restoration, Return scope, and SVG/Record portal behavior (passes).
- Existing Phase 1, structural facet, Overview, provider and four-route regression suites (passes).
- Could not run a complete Next.js build or authenticated browser/Virtuoso tests: this sandbox has no project `node_modules` and npm registry DNS lookup returns `EAI_AGAIN`.

## Still awaiting Phase 1 resolution or live acceptance

- **Critical acceptance:** Test stock sport grouping end-to-end (six groups: Surfing=2, five other groups=1; all seven Place members), with normal grouping, ungroup/regroup, Back/Forward and share URL restoration. Inspect the actual FCT response if any mismatch remains.
- Test Bookmarks Perspective → View/Providers → Return, as well as Browse → Providers → Return and provider-to-provider switches, with actual endpoint and ribbon UI.
- Verify the three SVG React console warnings are gone. **Nested `<button>` hydration warning is not claimed fixed**: neither checked-in JSX nor the bundled XSLT trees contain literal native `<button>` descendants of `<button>`; a runtime React component stack is needed to identify the dynamically composed trigger responsible.
- Confirm that Place Record values render for Texas and other States. If still blank, capture XSLT-generated HTML before the component portal and inspect the RecordValuePages portal/hydration output; do not hide the missing-values defect behind pagination.
- Other Phase 1 goals from v0.1.0 remain unaccepted or incomplete: complete Tag Cloud and Bookmarks Perspective lifecycle fixes; maximum-update-depth errors; Overview actual numerator/denominator verification; Maps qualification and pin display; full temporal restoration; complete FCT/XState write-boundary audit; History/Bookmark first-attempt persistence; URL language override Back/Forward and all consuming queries; and browser-level cancellation/race tests.

## Commands

Apply at the repository root with PowerShell `Expand-Archive -Force`. Run `npm.cmd ci`, focused `node --test` suites, then `npm.cmd run build` and `npm.cmd run dev`. Debug panel: `http://localhost:3000/?maestroLifecycle=1`.
