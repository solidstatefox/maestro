# Maestro Phase 1/2 — v0.4.0 incremental overlay

**Baseline:** `maestro 3(1).zip` + Phase 1 v0.1.0 + v0.2.0 + user-accepted v0.2.1 Group-by fix + Phase 1 v0.3.0. Apply this archive **after** v0.3.0. It contains only files added/changed relative to v0.3.0.

## Implemented in v0.4.0

1. **Group-by member-loading regression** (`workspace-controller`, Browse presentation): keep the user-confirmed v0.2.1 facet-equivalent group-value query and counts intact; fetch member lists in a separate query-scope-keyed/cancellable lane, retry missing member state when the data is absent, regardless of whether the group heading list changed, and do not confuse initial unloaded with terminal error. The center still uses derived FCT member queries with `group` removed only in cloned query trees. **Needs browser verification** that the 6 stock sport cards list the 7 Place members, after toggling Group-by and reloading.
2. **Root URI autocomplete**: one bounded indexed, exact signal-high SPARQL request using selected label predicates; choose distinct URI suggestions by Virtuoso IRI rank first, then optionally fetch asserted classes and prune superclasses, instead of a follow-up class query. The generic existing SPARQL transport's autocomplete-priority safety gate accommodates the bounded merged query; no new route.
3. **SPARQL inspector**: durable, controlled shadcn Base UI dialog mounted in the workspace (outside root hover editor), with blurred backdrop, title, graph source, explicit Close button, and captured Code Block; suggestions suspended while inspecting. No query mutation on open/close.
4. **Fullscreen Record**: dedicated **Set query** action commits queued wand selection then shrinks; **Shrink** only closes. Validate and Format dropdown portals render in a layer above the fullscreen explorer.
5. **Place Record**: proportional hero height capped at half its previous maximum with `object-fit: contain`, default map zoom reduced 11→9, and local 10-property-group pagination around the existing per-value pagination. Provider Turtle and eight embedded XSLT stylesheets parsed successfully; **RDF reseeding is required** for policy changes.
6. **Numeric facet**: direct inline editing on the user-writable From/To endpoints, commit on outside-click blur to the authoritative FCT `<value>` through existing `onRangeChange`; observed MIN/MAX are read-only. No Apply/Enter/Cancel/Escape handler and no imperative slider sync.
7. **Operator-aware example prefixes**: central pure predicate selector used by root/path breadcrumb badges, submenu example headers, and Configure; `i.e.` only for FCT equality (including implied equality when `op` absent), `e.g.` for regex, contains, numeric comparisons, and ranges. No changes to query semantics.
8. **Advanced aggregation design**: Phase 3 design document added to preserve previously approved requirements; this is **not** an implemented aggregation feature.

## Preserved from baseline

- User-confirmed correct v0.2.1 Group-by sport values and counts: Surfing 2; Basketball, Baseball, Rodeo, Skiing, Sled dog 1 each. No modification to `createGroupValuesQuery()` or the count-sorted facet contract.
- Phase 1 v0.3.0 Graph Servers provider discovery, approval and XState improvements; History/Bookmark fixes; no `indexLang` on new `<view>`.
- Existing query-change/refresh pipeline and only four generic proxy endpoint families.

## Validation performed

- Combined Node suites: **53/53 passed** (46 inherited source/behavior checks + 7 focused v0.4.0 regressions).
- TypeScript parser: **357 src TS/TSX/JS/JSX files parsed without syntax diagnostics**. This is *syntax checking*, not a full typecheck or Next.js build.
- RDF: `graph/maestro-dbpedia-policies.ttl` parsed to 294 triples, including 8 parseable embedded XSLT stylesheets.
- Archive integrity: ZIP paths and CRC verified during packaging.

## Not closed / live acceptance required

**Phase 1**: actual browser confirmation of Group-by member loads and cancellation; first-save Bookmarks History readiness/Return; Graph Servers and Map SHACL eligibility (requires effective approval, graph seeding); Tag Cloud and Bookmarks Perspective lifecycle; remaining maximum-update-depth feedback loops; Overview label counts; Temporal precise tab/cell restoration; URL language override Back/Forward; Texas Place formatter values. Static tests do not prove these are resolved.

**Phase 2**: remaining nested `<button>` hydration warning (no component owner stack is supplied; no reliable runtime reproduction); View dropdown alignment, appbar ButtonGroup modernization, Categories/Query Tree/root breadcrumb visual details, resizable handle interactions, and interactive browser acceptance of Record dialogs/numeric/hero/map and autocomplete. Do not claim these are all finished from static checks. Use the browser React owner stack to pinpoint any still-nested host buttons rather than broadly changing correct accessible controls. Extractors, Kanban and advanced aggregates remain Phase 3.

**Full build:** unavailable in this environment because project `node_modules` is absent and npm registry access was unavailable. Run `npm.cmd ci`, `npm.cmd run build`, and `npm.cmd run dev` on Windows, then validate `http://localhost:3000/?maestroLifecycle=1`.

## Smoke test order

1. Original stock `latitude of → Place, sport, timezone`, group by sport: six headings, correct counts, **each group's members shown**; ungroup/re-group; History Back/Forward.
2. Root URI autocomplete for `Water`/`Martha`: exact indexed suggestion query, correct URI ordering, one class-enriched request; open inspector and move mouse away, copy, close.
3. Fullscreen Texas Record: Validate and Format menus, Shrink without committing vs Set query committing.
4. Numeric writable From/To edit by click then click-outside; read-only observed MIN/MAX; History undo.
5. Place policy re-seeded: complete smaller hero image, map context, ten-property pagination and actual property values.
6. `=`, `regex`, `contains`, comparisons and ranges show correct `i.e.`/`e.g.` prefixes.
7. Browser console: record exact component stack if nested `<button>` warning persists.
