# EU Data Explorer — Project Result enrichment and XML-only list-values

One `mui:Provider`, running against **the currently selected Maestro graph server only**. This update also changes generic FCT compilation and its existing list-values callers to express projection facets and already-selected resource pages in FCT XML; it does not add a transport endpoint, change the live Browse query, run dual-endpoint searches, or use SPARQL `SERVICE` federation.

## Install / graph seeding

Extract the delta over the previously installed EU Data Explorer patch and run `npm.cmd run build`. **Keep the existing repaired `graph/manifest.json`** that registers `eu-data/provider.ttl` and the relocated DBpedia policy. Do not re-run the retired manifest-merging commands or recreate `manifest-entries.json`. Log out and back in after building so the updated `provider.ttl` (including the new enrichment stylesheet) is reseeded. No new manifest entry is required: `project-results-query.xsl` is a readable source copy; its actual XSLT is embedded in the already seeded `provider.ttl`.

Do not merge `legacy-manifest-entries-OPTIONAL.json` by default: the user's files labelled `shapes_recommended.ttl` and `mdr-vocabularies.shape.ttl` identify older **DCAT-AP 2.1.1**, while their `shapes.ttl` and `range.ttl` identify **DCAT-AP 3.0.0**. The originals are included **byte-for-byte** as uploaded. They must not be represented as four homogeneous DCAT-AP 3.0.1 files.

`endpoints.ttl` adds both services to the Most reliable graph registry, but no query targets both concurrently. Select whichever is needed from the normal graph-server chooser. The original baseline's misnamed “EU data portal (Cordis)” entry is not changed, because it lives in the forbidden `graph/dataserver-seed.ttl`.

## Contents

- `provider.ttl`: one approved provider with a generic current-result-page Perspective and one class-dispatching Record formatter. XSLT stored in RDF literals as the existing provider system requires.
- `perspective.xsl`: readable source of the embedded Perspective XSLT. It transforms the current FCT result page; all resource actions are ordinary Maestro `data-provider-open-uri` buttons. Does not make a SPARQL request, switch graph servers, or embed executable scripts.
- `record.xsl`: readable source of the embedded Record XSLT. Contains **eleven named type-specific layouts** (Project, Organisation, Person, Grant, Result, Role, Dataset, Distribution, DataService, Catalog, CatalogRecord), selected by actual RDF `rdf:type`. The Project layout has title/status, keywords, a timeline, numbered Results, narrative and sparse Details. Missing values and empty sections disappear. Result titles and DOI metadata come from linked `eurio:Result` triples; RDFa and standard Record interactions are retained.
- `project-results-query.xsl`: graph-declared XSLT 3.0 query pivot. On a Project Record with `hasResult`, clones the existing FCT query *without mutating Browse*, binds the selected Project IRI at the root, moves its view under `eurio:hasResult`, selects `list-values`, and declares `eurio:title` and `eurio:doi` as optional XML projection facets. The existing Record enrichment host executes it and appends returned typed RDF triples before rendering. Result titles and DOIs are never fabricated.
- `record-policies.ttl`: eleven `mui:ClassPolicy` mappings needed by the unchanged Record resolver.
- `record-shapes.ttl`: eleven explicit **projection-safe** SHACL class shapes used for Record eligibility/validation. They are not full conformance validators.
- `eurio-validation.ttl`: six supplemental EURIO shapes with modest optional checks; no invented mandatory properties.
- `dcat-ap-3.0.0/{shapes,range}.ttl`: original uploaded official DCAT-AP 3.0.0 constraints for **complete-record validation only**.
- `dcat-ap-legacy-2.1.1/{shapes_recommended,mdr-vocabularies.shape}.ttl`: original uploaded older constraints, retained separately to avoid silently imposing incompatible requirements.
- `endpoints.ttl`: additive Most Reliable registry records for the two actual SPARQL services.
- `graph/dbpedia/maestro-dbpedia-policies.ttl`: byte-for-byte relocation of existing file.

## Scope and existing host limitations

1. Approval: the unchanged Record resolver requires both the **single provider** and the selected class **policy** to be approved. It does **not** support one approval automatically approving all ClassPolicies.
2. Full DCAT-AP conformance requires a complete-enough source graph. Maestro currently validates its **partial Record projection** before showing a formatter. Using mandatory official DCAT-AP shapes directly as `mui:recordShape` would incorrectly hide otherwise valid Record formatters, so `record-shapes.ttl` has safe lightweight class shapes, and the official strict shapes are independently available for proper full-dataset validation.
3. The generic Perspective host exposes the **current FCT results page**, not arbitrary graph-wide funding/network/geographic aggregates. Accordingly the Perspective is a polished single-source research/dataset resource explorer; no fake cross-source combined counts, maps, or funding metrics are shown. The class-specific Records display verified predicates if present, without inferring cross-dataset equivalence.
4. The generic View renderer sanitizes executable scripts. No new chart or map infrastructure is included in this Project-focused patch. The generic XML-only FCT changes are limited to `list-values` projection and its callers. Projection columns are obtained from focus-scoped `<property>` and `<property-of>` nodes. All these nodes retain normal FCT selection semantics; a `uid` group requests an explicit OR across the requested alternatives. Bound scoped facets are included as columns with exact RDF values. No implicit OPTIONAL/ANY mode is used; a resource without any matching union branch is not selected.
5. The eleven candidate EURIO classes follow the earlier design; actual class occurrences/predicates should be checked against the live CORDIS ontology before claiming live coverage, because some CORDIS result types are more specific than `eurio:Result`.

## Quality checks

The provider RDF and its embedded Record and query-enrichment stylesheets are valid Turtle/XML and agree with their standalone XSLT files. Relevant TypeScript modules pass syntax checks; local dependency-free tests pass. The full Next.js build and live endpoint/fullscreen behavior must be verified in a workspace with dependencies installed. No root graph manifest or datasource seed file is changed.

Sources: CORDIS Datalab SPARQL documentation https://cordis.europa.eu/about/sparql ; EU DCAT-AP releases https://semiceu.github.io/DCAT-AP/releases/3.0.0/ .
