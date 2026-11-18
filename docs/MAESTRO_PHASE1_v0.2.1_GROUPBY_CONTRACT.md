# Maestro Phase 1 v0.2.1 — Group-by facet contract restoration

## Baseline / installation

Incremental changed-files-only overlay against `maestro_phase1_v0.2.0_changed_files.zip`, which itself was applied over v0.1.0 + `maestro 3(1).zip`.

## Comparison with supplied old implementation

The old source (`src (2)(5).zip`) did **not** define a `<view type="list-groups">`. In `src/lib/fct-query-derived.ts`, `createGroupValuesQuery()` created a temporary FCT clone of the Personal facet query, with `<view type="list" sort="count">` (or `type="classes" sort="count"` for Categories). Both the Personal facet and the center Group-by pane independently requested that same derived query XML (apart from paging when on later group pages). The selected group's member list was obtained through a distinct derived FCT query.

The v0.2.0 refactor retained the shared `createGroupValuesQuery()` call sites but accidentally omitted `sort="count"` from its return value. `setQueryViewAttributes()` preserved the original `sort=""`, so `fct-sparql-translator.ts` compiled a normal LIST SELECT returning `(value, SAMPLE(recordParent))`, instead of the group LIST SELECT returning `(value, COUNT(DISTINCT focus), [optional recordParent])`. A sampled latitude such as 40 could then be interpreted as a group count, producing the observed 40 > 7 failure. This was a query-projection bug, not a legitimate count validation failure.

## Changes

1. Restore `sort="count"` on **derived group-heading** `<view>` clones, for Property, Role and Category grouping. Live `<view>` location, type, sort, `group="true"`, query IDs, and other constraints remain unchanged.
2. For active grouped Property and Role facet value rows, show counts from the same count-sorted FCT rows that supply Group-by headings. Do not request independent `DistinctCount` queries for the same grouped values; this removes unrelated error `!` badges on grouped rows. Ordinary ungrouped facets keep their distinct-count requests unchanged.
3. Preserve existing typed FCT decoding and old-style group-member FCT clones; no `list-groups` type, no parsing SPARQL text, and no hardcoded SPARQL projection aliases.

## Regressions

`tests/maestro-phase1-v021-groupby-contract.test.cjs` runs the actual `createGroupValuesQuery()` function against a fixture matching the `latitude/Place/sport/timezone` query, verifies `list + sort=count` under sport and unchanged live query, verifies Category count sorting, and asserts both left facet listeners and center use the shared query factory and counts.

The broader focused test command includes this test plus v0.2.0 and other Phase 1 tests.

## Not claimed

- No authenticated Virtuoso request, browser acceptance, or full Next.js production build has run in the patch container. Run the build and test on the workstation, then verify the six sports with counts Surfing=2 and the five others=1.
- The old implementation issued a logically identical FCT query from two consumers; it was not a guaranteed single HTTP request. This patch preserves that contract but does not restructure both consumers into one shared network response. It is deliberately focused on restoring the old semantics.
- The separately reported nested `<button>` hydration warning and broader Phase 1 provider-discovery issues are not addressed by this Group-by-only overlay.
