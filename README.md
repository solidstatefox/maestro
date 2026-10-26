# Maestro (Dashboard for Virtuoso's facets API)

A web-based dashboard for exploring RDF data through Virtuoso's Faceted Browser (FCT) API. Built with Next.js, TypeScript, Tailwind CSS, and shadcn/ui.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- npm
- One or more accessible SPARQL endpoints

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/solidstatefox/maestro.git
cd maestro
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure the personal SPARQL store and named graphs

Maestro reads its selectable Datasites from an RDF registry in your personal SPARQL store. Configure each named graph with `MAESTRO_DATASERVERS_GRAPH`, `MAESTRO_QUERY_FAVORITES_GRAPH`, and `MAESTRO_ONTOLOGY_CACHE_GRAPH`. These are named graph IRIs, not remote SPARQL service URLs. The older semicolon-separated `SPARQL_ENDPOINTS` setting remains as a fallback for existing installations; the dedicated variables take precedence. `MAESTRO_IDS_NAMESPACE` separately configures the base namespace used to mint Maestro-managed resource identifiers and is not a named graph.

Create `.env.local` in the project root (you can copy `.env.example`) and configure it like this for a local Virtuoso Community Edition server:

```env
MAESTRO_QUERY_CACHE_MAX_ENTRIES=1000
MAESTRO_DATASERVERS_GRAPH=gttp://ggg.maestro.ecosys/dataservers
MAESTRO_QUERY_FAVORITES_GRAPH=gttp://ggg.maestro.ecosys/query-favorites
MAESTRO_ONTOLOGY_CACHE_GRAPH=gttp://ggg.maestro.ecosys/ontology-cache
MAESTRO_IDS_NAMESPACE=gttp://ggg.maestro.ecosys/ids/
# Optional legacy fallback: SPARQL_ENDPOINTS=gttp://ggg.maestro.ecosys/dataservers;gttp://ggg.maestro.ecosys/query-favorites;gttp://ggg.maestro.ecosys/ontology-cache
PERSONAL_SPARQL_ENDPOINT=http://localhost:8890/sparql
RDF_LOADER_USERNAME=
RDF_LOADER_PASSWORD=
```

The three graphs have distinct purposes:

- `gttp://ggg.maestro.ecosys/dataservers` — the RDF registry that lists selectable Datasites and their display groups. Maestro reads this graph.
- `gttp://ggg.maestro.ecosys/query-favorites` — saved query bookmarks and the original FCT query XML. Maestro reads and writes this graph.
- `gttp://ggg.maestro.ecosys/ontology-cache` — RDF documents discovered for the Categories hierarchy. Maestro reads and ingests RDF into this graph.

Keep these final path segments (`/dataservers`, `/query-favorites`, and `/ontology-cache`) when changing the graph IRIs. The selectable endpoint URLs themselves are stored as RDF records in the configured Datasites graph; they are no longer configured as `Name=URL` entries in `.env.local`. The bundled `rdfs/dataservers-seed.ttl` uses the default `MAESTRO_IDS_NAMESPACE`; if you customize that namespace, replace its base IRI in the seed before loading it so seeded resource identifiers match the app configuration. Group resources use `<MAESTRO_IDS_NAMESPACE>dataservers/<readable-group-id>`, and each server resource uses that group IRI plus `#<readable-server-id>`. Prefer stable, human-readable slugs whenever the group or server has a meaningful name. For example, the “Featured” group is `gttp://ggg.maestro.ecosys/ids/dataservers/featured`, and the OpenLink vector demo server is `gttp://ggg.maestro.ecosys/ids/dataservers/featured#openlink-vector-demo-dbpedia-search-by-meaning`. Use unique slugs within each group and keep them stable; UUIDs are appropriate only when no meaningful readable identifier is available.

`PERSONAL_SPARQL_ENDPOINT` identifies the SPARQL HTTP endpoint used for these operations. `RDF_LOADER_USERNAME` and `RDF_LOADER_PASSWORD` are optional credentials. The endpoint path matters for Virtuoso authentication:

- `/sparql` uses Virtuoso's shared `SPARQL` service account. Supplying Basic Auth variables does not make the standard endpoint act as a different database user.
- `/sparql-auth` authenticates using the database account supplied in `RDF_LOADER_USERNAME` and `RDF_LOADER_PASSWORD`. Use this path if you want Maestro to use a dedicated account.

For example, to use a dedicated account, set `PERSONAL_SPARQL_ENDPOINT=http://localhost:8890/sparql-auth`, then fill in both credential variables. Do not put credentials directly in the endpoint URL. Restart Maestro after changing `.env.local`.

#### RDF vocabulary and existing data migration

Maestro uses standard RDF vocabulary terms for generic metadata instead of app-specific `label`, `type`, `created`, `name`, and `url` predicates:

- `rdf:type` identifies resource classes and `rdfs:label` supplies searchable human-readable labels ([RDF Schema](https://www.w3.org/TR/rdf-schema/)).
- `dcterms:created` and `dcterms:references` describe bookmark creation time and the referenced saved query ([Dublin Core Terms](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/)).
- `sioc:Item` types a bookmark-like item ([SIOC](https://rdfs.org/sioc/spec/)).
- Datasites use `schema:EntryPoint`, `schema:url`, `schema:position`, `skos:Collection`, and `dcterms:isPartOf` for endpoints, URLs, ordering, groups, and group membership ([Schema.org EntryPoint](https://schema.org/EntryPoint), [SKOS](https://www.w3.org/TR/skos-reference/)).

The saved FCT XML is stored as an `rdf:XMLLiteral` using `rdf:value`. Maestro keeps a small number of FCT-specific predicates only where they represent FCT/XML structure (such as parent-to-child XML element links). Bookmark titles and query/XML text are also emitted as `rdfs:label` values, so label-based search can find them.

If you already loaded the earlier B19.9 dataservers seed and saved bookmarks, the old triples remain in your store. The application can still read the older dataservers/favorites representation, but run the following additive SPARQL updates once in Conductor's SPARQL query/update interface (or another authorized SPARQL Update client) to add standard-vocabulary triples to existing records. They do not delete the old triples. Use the exact graph IRIs configured by the corresponding `MAESTRO_*_GRAPH` variables if yours differ.

**Migrate the existing Datasites registry:**

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX schema: <https://schema.org/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
INSERT { GRAPH <gttp://ggg.maestro.ecosys/dataservers> {
  ?server rdf:type schema:EntryPoint ; rdfs:label ?name ; schema:url ?url .
  ?server schema:position ?serverOrder ; dcterms:isPartOf ?group .
  ?group rdf:type skos:Collection ; rdfs:label ?groupName ; schema:position ?groupOrder .
} }
WHERE { GRAPH <gttp://ggg.maestro.ecosys/dataservers> {
  ?server rdf:type <gttp://ggg.maestro.ecosys/dataservers#Dataserver> ;
          <gttp://ggg.maestro.ecosys/dataservers#serverName> ?name ;
          <gttp://ggg.maestro.ecosys/dataservers#serverURL> ?url .
  OPTIONAL { ?server <gttp://ggg.maestro.ecosys/dataservers#serverOrder> ?serverOrder }
  OPTIONAL {
    ?server <gttp://ggg.maestro.ecosys/dataservers#inGroup> ?group .
    ?group <gttp://ggg.maestro.ecosys/dataservers#groupName> ?groupName .
    OPTIONAL { ?group <gttp://ggg.maestro.ecosys/dataservers#groupOrder> ?groupOrder }
  }
} }
```

**Migrate existing saved bookmark titles, timestamps, query links, and XML literals:**

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX sioc: <http://rdfs.org/sioc/ns#>
PREFIX vfct: <https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#>
INSERT { GRAPH <gttp://ggg.maestro.ecosys/query-favorites> {
  ?bookmark rdfs:label ?title ; dcterms:created ?created ;
            dcterms:references ?query ; rdf:type sioc:Item .
  ?query rdf:value ?xml .
} }
WHERE { GRAPH <gttp://ggg.maestro.ecosys/query-favorites> {
  ?bookmark rdf:type vfct:QueryBookmark ; vfct:label ?title ;
            vfct:created ?created ; vfct:savedQuery ?query .
  ?query vfct:queryXML ?xml .
} }
```

To make the older XML-tree nodes searchable too, copy their element/text labels and attribute values into standard label/value properties:

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX vfct: <https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#>
INSERT { GRAPH <gttp://ggg.maestro.ecosys/query-favorites> { ?node rdfs:label ?label } }
WHERE { GRAPH <gttp://ggg.maestro.ecosys/query-favorites> {
  { ?node vfct:elementName ?label }
  UNION
  { ?node vfct:content ?label FILTER(STRLEN(STR(?label)) > 0) }
} }
```

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX vfct: <https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#>
INSERT { GRAPH <gttp://ggg.maestro.ecosys/query-favorites> { ?node rdfs:label ?label ; rdf:value ?value } }
WHERE { GRAPH <gttp://ggg.maestro.ecosys/query-favorites> {
  ?node vfct:attributeName ?name ; vfct:attributeValue ?value .
  BIND(CONCAT(STR(?name), ": ", STR(?value)) AS ?label)
} }
```

After migrating, new saves use the standard predicates by default. You can later remove obsolete triples once you have verified that no other consumer depends on them.

#### Virtuoso permissions (least privilege)

Virtuoso checks both the SPARQL role and the user's permission on each named graph. Granting a role alone is not enough. Configure permissions as a Virtuoso administrator (`dba`) in Conductor at `http://localhost:8890/conductor`. See the official [SPARQL endpoint security documentation](https://docs.openlinksw.com/virtuoso/rdfsparqlprotocolendpoint/), [RDF graph-level security documentation](https://docs.openlinksw.com/virtuoso/rdfgraphsecuritylevel/), and [graph security configuration examples](https://docs.openlinksw.com/virtuoso/rdfgraphsecurityintconfsec/).

**1. Grant only the SPARQL role Maestro needs.** Maestro runs `SELECT` queries and SPARQL updates (`INSERT DATA` for bookmarks and `LOAD` for ontology ingestion). Virtuoso documents that `SPARQL_UPDATE` includes `SPARQL_SELECT`, so you do not need to grant every available role. In Conductor, go to **System Admin → User Accounts → Users → Edit** for the relevant account, set its user type to **SQL/ODBC and WebDAV** (wording may vary by Virtuoso version), add the `SPARQL_UPDATE` role, and save.

- If `PERSONAL_SPARQL_ENDPOINT` ends in `/sparql`, grant `SPARQL_UPDATE` to the built-in **`SPARQL`** service account, because that endpoint executes requests as that account. The Basic Auth username/password in `.env.local` do **not** change that identity.
- If it ends in `/sparql-auth`, grant `SPARQL_UPDATE` to the account named by `RDF_LOADER_USERNAME`; this endpoint uses those credentials to authenticate the configured account.
- If you plan to use both endpoint paths, grant the role and graph permissions to both accounts. Otherwise, configure only the account used by the endpoint path you selected. Do not give either account every available role.

**2. Grant graph-level access.** In Conductor's SQL execution interface, logged in as `dba`, run the statements for the account that actually serves requests. These permission masks are: `1` = read; `3` = read + SPARQL Update write; `7` = read + SPARQL Update write + RDF network-resource fetch (the additional bit 4 permission).

For the standard `/sparql` endpoint, grant the minimum permissions to the built-in `SPARQL` account:

```sql
-- Datasites registry: read only
DB.DBA.RDF_GRAPH_USER_PERMS_SET(
  'gttp://ggg.maestro.ecosys/dataservers', 'SPARQL', 1
);
-- Saved bookmarks: read and write
DB.DBA.RDF_GRAPH_USER_PERMS_SET(
  'gttp://ggg.maestro.ecosys/query-favorites', 'SPARQL', 3
);
-- Ontology cache: read, write, and LOAD remote RDF documents
DB.DBA.RDF_GRAPH_USER_PERMS_SET(
  'gttp://ggg.maestro.ecosys/ontology-cache', 'SPARQL', 7
);
```

For `/sparql-auth`, repeat those three statements with the actual account configured as `RDF_LOADER_USERNAME` in place of `'SPARQL'` (for example, `'maestro_app'`). For example, if you intentionally use **both** endpoint paths, run the statements for `SPARQL` and again for the configured account. Do not grant either account write access to every graph. If your graph IRIs differ from the examples, use the exact IRIs configured by the corresponding `MAESTRO_*_GRAPH` variables.

These permissions are the minimum for Maestro's current behavior: it only reads the Datasites registry, reads/writes saved query favorites, and reads/writes the ontology cache while loading remote RDF. If you later disable ontology ingestion, the ontology graph's permissions can be reduced accordingly.

**Security:** Do not commit `.env.local` or any file containing private credentials to Git.

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tech Stack

- [Next.js](https://nextjs.org/) — React framework
- [TypeScript](https://www.typescriptlang.org/) — Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) — Utility-first CSS framework
- [shadcn/ui](https://ui.shadcn.com/) — Customizable UI components
- [OpenLink Virtuoso](https://virtuoso.openlinksw.com/) — RDF database and Faceted Browser API

## shadcn/ui Components

The project uses shadcn/ui components that are included directly in the codebase and can be customized as needed.

To add another component, run:

```bash
npx shadcn@latest add button
```

Replace `button` with the component you want to install. Browse the available components in the [shadcn/ui documentation](https://ui.shadcn.com/docs/components).

To initialize shadcn/ui in a new Next.js project, run:

```bash
npx shadcn@latest init
```

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com/docs)
- [Virtuoso Documentation](https://docs.openlinksw.com/virtuoso/)
- [Virtuoso Faceted Browser](https://vos.openlinksw.com/owiki/wiki/VOS/VirtuosoFacetsWebService)
- [SPARQL Query Language](https://www.w3.org/TR/sparql11-query/)
- [Resource Description Framework (RDF)](https://www.w3.org/TR/rdf11-concepts/)