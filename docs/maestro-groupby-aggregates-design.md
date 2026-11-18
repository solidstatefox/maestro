# Maestro grouped FCT results — design notes

Maestro's FCT query tree is authoritative. A `<view type="list">` remains on
its original focus node; a sibling in-scope `<property>` or `<property-of>` with
`group="true"` represents a viewer-level grouping request. Groups outside the
view carrier's immediate scope are invalid, not silently applied.

## Aggregation and identity

A group is identified by its canonical RDF term (URI, blank node, or literal
with datatype and language). Do not merge distinct language-tagged literals.
Count DISTINCT groups only after applying the same live-query WHERE scope used
for member results; never sum repeated FCT count rows. Group membership must
not alter the query identity of an individual Record.

The `group` flag is viewer-plane metadata: cloned FCT queries for facets,
counts, provider preflight and Record reading must remove it. Generated SPARQL
must not rely on independently sampled parent values to identify blank nodes.

## Pagination

The list's `limit` and `offset` are authoritative. Pages need stable ordering
and a consistent live query/context identity; late responses for an older scope
must never replace the current page. A page of groups must not share offsets
with a page of group members.

## Acceptance checks

Exercise URI and literal groups, language-qualified values, Properties and
Roles, multiple groups, page transitions and cancellation. Confirm that
counts, pagination and query restoration remain consistent with the original
FCT population.
