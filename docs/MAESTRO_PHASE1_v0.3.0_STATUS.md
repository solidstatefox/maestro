# Maestro Phase 1 v0.3.0 — Perspective discovery and final source-level stabilization

**Patch baseline:** `maestro 3(1).zip` + `maestro_phase1_v0.1.0_changed_files.zip` + `maestro_phase1_v0.2.0_changed_files.zip` + `maestro_phase1_v0.2.1_groupby_contract_changed_files.zip`, applied sequentially. v0.3.0 is an incremental changed/new-files-only overlay on v0.2.1. **Do not omit v0.2.1: its restored count-sorted, shared facet-equivalent Group-by query is confirmed working by the user.**

## Changes implemented in v0.3.0

1. **Graph Servers Perspective registration and discovery:** `EntryPointCards` remains a `mui:CardGridWidget` and is also typed `mui:PerspectiveWidget`. Its real provider has a readable `rdfs:label`. View discovery now looks up the actual `mui:Provider` and its `mui:accepts` SHACL input (`sh:class`/`sh:targetClass`), or a separately validated contextual provider ID. It checks effective provider approval by the existing direct-approval OR version-matched approved-curator mechanism; it no longer requires a separate status assertion on the SHACL shape or simultaneously demands a curator. **No Graph Servers ribbon is hardcoded:** the user's personal graph must contain the reseeded provider and the provider must be effectively approved.
2. **Actual FCT population evidence:** The View discovery scope uses currently loaded positive-count Categories (result `rdf:type` classes) as well as explicit FCT `<class>` constraints. It only accepts Categories from the current query/server/refresh scope. This allows a population of EntryPoint resources without requiring a syntactic `<class schema:EntryPoint>` constraint. Discovery does not assume a registry endpoint is in the current population.
3. **Query-scoped XState ribbon result:** Removed the separately maintained React `discoveredViews` copy. The ribbon reads the one actor snapshot only when its discovery key corresponds to the current query, selected endpoint, refresh, login/approval context and class evidence; pending results from older queries cannot populate the new ribbon. Class-based discovery no longer waits for unrelated contextual History validation; query-targeted discovery still requires successful contextual validation.
4. **History identity:** Contextual History validation uses a committed visit IRI only if its associated query XML exactly matches the current live query. It cannot pair new XML with the previous History ID. Bookmark submission now tolerates failure of an older queued History job and still checks/commits the exact current query before proceeding; new write failures still propagate.
5. **Tag Cloud provider applicability stability:** The query-scope fingerprint excludes nonsemantic XML allocation IDs/counters, viewer-only `group`, paging, and Temporal editor-only UI metadata. It retains actual constraints, graph and focus, so a tag-cloud provider that is eligible for the same query doesn't become ineligible solely because the query was reserialized with new identifiers.
6. **React trigger composition:** Flattened several cross-library Tooltip + Dropdown trigger compositions into single native button hosts (root name menu, appbar graph server dropdown, left facet action menu and breadcrumb sibling dropdown). This avoids a class of accidental nested-button hydration errors while preserving the underlying action. It is NOT proof that every possible nested-button warning is resolved: obtain a browser React component stack if it persists.

## Preserved verified behaviors

- The user's accepted **v0.2.1** Group-by behavior: same facet-equivalent derived query (including `sort="count"`) for the left grouped Personal facet and the center Group-by headings, member requests from bound derived FCT clones, no SPARQL-regex inference, no live `<view>` mutation. This patch does not alter `src/lib/fct-query-derived.ts`, Group-by compiler, decoder or Group-by rendering.
- One authoritative writable FCT tree; XState owns workflow and key-scoped asynchronous request acceptance, not a second query.
- URL-only language override and no `<view indexLang>` in production, pending browser acceptance, remain as implemented in v0.1.0.
- Earlier Map, SVG, Place, Temporal, Overview, breadcrumb and Return fixes remain unchanged except for listed files.

## Validation and limitations

- The focused Node regression suite (including v0.2.1 shared Group-by contract and v0.3.0 discovery tests) was run in this patch workspace.
- TS/TSX source syntax parsed with TypeScript; the changed provider Turtle parses with RDFLib.
- Full production `npm.cmd run build` and authenticated browser tests could not run in this container because `node_modules` is absent and npm registry access has failed. Workstation builds are mandatory.
- Browser acceptance **still required** for Graph Servers discovery with an authenticated personal graph, direct/inherited approval, population without an explicit `<class>`, and provider reseeding; Bookmarks → Providers → Return; Bookmarks first-attempt save; Tag Cloud revisit; Map pin eligibility/display; Place values after rendering; Temporal restoration; URL-only language Back/Forward; Overview actual counts; and maximum-update-depth investigation.
- The user has reported `<button>` nested in `<button>` warnings, but the component stack does not establish their precise source. The composition simplifications address plausible trigger paths; do **not** regard this as a proven fix without browser verification.
- Phase 2 (autocomplete inspector and ranked class merge, fullscreen Record UI, Numeric bound editing, Place hero/pagination/map zoom, layout) and Phase 3 (Extractors, Kanban, aggregates) are intentionally out of scope.

## Workstation installation and testing (PowerShell)

Apply this v0.3.0 ZIP *after* v0.2.1 at the Maestro repository root:

```powershell
$patch = Join-Path $env:USERPROFILE 'Downloads\maestro_phase1_v0.3.0_changed_files.zip'
Expand-Archive -LiteralPath $patch -DestinationPath (Get-Location).Path -Force
npm.cmd ci
node --test tests/maestro-phase1-v030-perspective-discovery.test.cjs tests/maestro-phase1-v021-groupby-contract.test.cjs tests/maestro-phase1-v020-regressions.test.cjs tests/maestro-phase1-acceptance.test.cjs tests/maestro-return-browse-only.test.mjs tests/maestro-perspectives-providers.test.mjs tests/maestro-overview-chart-lifecycle.test.mjs tests/maestro-followup-overview-record-query.test.mjs tests/maestro-spa-openapi-four-routes.test.mjs
npm.cmd run build
npm.cmd run dev
```

Dev XState panel: `http://localhost:3000/?maestroLifecycle=1`. Because `graph/maestro-widget-providers.ttl` changed, reseed the personal graphs at login before testing Graph Servers. The exact browser result depends on effective provider approval and the current FCT population.
