# Sankey — first-pass Analysis provider

URI: `gttp://ggg.maestro.ecosys/analyze/sankey`

The provider is discovered and approved using the same query-contextual SHACL
and curator workflow as Spider. On login, the graph manifest seeds its Turtle
into the user's personal SHACL policies graph. It must be effectively approved
before appearing in Analyze. No new proxy route is involved.

The current renderer uses Recharts Sankey, but `src/lib/sankey-coverage.ts`
produces a library-agnostic `nodes` + `links` projection so D3 can replace it.
It follows the current FCT `<view>` scope's immediate property/property-of
siblings, projecting the current results page through the existing batched FCT
list-values transport; it does not enumerate a second population.

For every resource, coverage = 100 × count of distinct in-scope predicates
with at least one RDF term / total distinct in-scope predicates. Each present
predicate receives 100 / denominator percentage points; if multivalued, that
flow is divided equally between its distinct RDF terms. No flow is invented
for missing predicates. The FCT page node links to resource nodes, then to
predicate nodes, then to term nodes. The layers are intentionally acyclic.

The display is bounded to 20 page resources, 10 predicates and 8 distinct
term buckets per predicate. An `Other values` bucket retains all remaining
flow, and the denominator always uses *all* in-scope predicates, not just the
displayed subset. The percentage coverage of every displayed resource is also
visible as a clickable row even when it has zero coverage. Source identities
include RDF term type, datatype and language tag.

This is ONE relationship degree only. Traversing multi-hop paths, recursive
query-tree layering, richer node selection, and D3 layout are later phases.
It writes no RDF, stores no chart state, and changes no authoritative FCT XML.
