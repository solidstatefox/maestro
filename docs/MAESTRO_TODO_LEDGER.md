# Maestro TODO ledger — consolidated November 17, 2026

**Baseline:** `maestro 2(1).zip` + `maestro_post_accepted_todos_fix.zip` + `maestro_spider_build_fix.zip`. The present overlay is source-level work, not a verified Next.js production build or authenticated Virtuoso acceptance report.

## Source changes made by this overlay — require runtime acceptance

| Item | Source correction / implementation | Acceptance required |
|---|---|---|
| 34 — Shared identifiers | `ctr/id`, `uctr/uid`, and `rctr/rid` now share one letter-leading lowercase base-36 allocator; independent counters and legacy counter encodings retained. | z → a0, legacy counter/UID restoration, share URL stability. |
| 35 — Email derived facets | Add `rid`, `pid`, `rctr`, register RDF Email Regex provider, effective approval-gated browser discovery, and a generic derive action. The FCT normal/count compilers bind captured `REPLACE()` values instead of inventing RDF predicates. | Re-login/reseed policy graph; directly approve provider or its curator; use email facet, click Extract, ensure username/domain appear in left panel, Query Tree, breadcrumbs and produce bound rows. Check reverse roles and multi-valued emails. |
| 36 — Named regex filters | String widgets expose an editor for named `<value name="…" op="regex">` patterns; unchecked `enabled="false"` is retained but nonfiltering, multiple checked patterns combine using the existing AND semantics. | Add several patterns, check/uncheck, restore URL/history, verify same count/value filtering and no stale rows. |
| 37 — Group-by aggregates | Same sky colorway applied to group-by breadcrumb and Query Tree row. Architectural design at `docs/maestro-groupby-aggregates-design.md`. | **Aggregate SPARQL mode remains design-stage** pending explicit multi-value/group contributor-count decisions. Do not present grouping paint as completed aggregate support. |
| 38 — Texas Record SaxonJS | Correct unbound `$predicate` variables in DBpedia Place and related Record XSLTs; keep strict IDs. | Re-login/reseed and ensure Place formatter compiles with SaxonJS, using Texas record. |
| 39 — Query Tree root | Composite muted 5-bar backdrop + active signal icon and inherited Go To click action. | Test all signals, mouse/keyboard navigation and query restoration. |
| 40 — Root globe query inspector | Globe icon is a button opening a Code Block for the actual `createRootUriAutocompleteQuery` SPARQL generated from the current input/address/settings. | Test empty input, URI entry, search text, copy/close/keyboard. |
| New — repeated `skos:broader` | Prefer the actual structural view-sibling relationship before any same-IRI view carrier reuse, without relying on XML IDs or moving the live view. | University of Miami FCT repro: view remains under outer broader, values/counts come from inner broader. |
| New — Maps Perspectives discovery | Single shared XState discovery for Ribbon and Page, preserve a registered/approved Map even with zero points, show explicit discovery/approval errors, retry failed discovery on reentry. | Run provided Places/latitude query; confirm WGS84/GeoRSS resources show Maps and output points. |

## Earlier source repairs from accepted baseline requiring browser verification

- Tag Cloud deterministic rediscovery on breadcrumb return; Bookmarks ribbon must retain user selection after SHACL validation; XState selection/cancellation and View default Perspectives-first item selection.
- View dropdown alignment/collision jitter; root signal selection while expanded; Categories Selected preferred labels; Browse bottom toolbar always shown; root input border and persistent Classes/Status superscript; root go-to hover one-second grace; root selected styling including signal-zero.
- Browse left/right resizer isolation; Spider 0–100 scale hidden and tooltip pinned top-right (user confirmed Spider core functioning); Record formatter required element IDs; earlier maximum-update-depth/Perspectives render guards; Kinds XML/SPARQL inspector tabs.
- Appbar shadcn ButtonGroup, provider approval counts and acceptance ribbons, History/Bookmarked query restoration, all-user personal graph seeding, four generic proxy route boundary, Record Status projection and remaining XState migration audits.

## Closed

- URIBurner autocomplete TLS/certificate investigation: user confirmed autocomplete works against other graph servers. Do not include as a pending Maestro defect.

## Testing limitations

Source ZIPs have no `package.json`/`node_modules`; this environment cannot perform a production Next.js type-check, a running browser interaction test, or an authenticated Virtuoso reseed/query test. Static TypeScript/RDF checks and focused compiler tests are distinct from acceptance. Remaining runtime failures should be recorded with query XML, SPARQL, and transition traces, not silently marked resolved.
