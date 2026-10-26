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

### 3. Configure the personal SPARQL store and Datasites

Maestro uses four configurable Datasite IRIs: `MAESTRO_DATASERVERS_GRAPH`, `MAESTRO_QUERY_FAVORITES_GRAPH`, `MAESTRO_ONTOLOGY_CACHE_GRAPH`, and `MAESTRO_IDS_NAMESPACE`. Set each property to the Datasite IRI you want Maestro to use.

Create `.env.local` in the project root (you can copy `.env.example`) and configure it like this for a local Virtuoso Community Edition server:

```env
MAESTRO_QUERY_CACHE_MAX_ENTRIES=1000
MAESTRO_DATASERVERS_GRAPH=gttp://ggg.maestro.ecosys/dataservers
MAESTRO_QUERY_FAVORITES_GRAPH=gttp://ggg.maestro.ecosys/query-favorites
MAESTRO_ONTOLOGY_CACHE_GRAPH=gttp://ggg.maestro.ecosys/ontology-cache
MAESTRO_IDS_NAMESPACE=gttp://ggg.maestro.ecosys/ids/
PERSONAL_SPARQL_ENDPOINT=http://localhost:8890/sparql
RDF_LOADER_USERNAME=
RDF_LOADER_PASSWORD=
```

The three main Datasites have distinct purposes:

- `gttp://ggg.maestro.ecosys/dataservers` — the RDF registry that lists selectable Datasites and their display groups. Maestro reads this Datasite.
- `gttp://ggg.maestro.ecosys/query-favorites` — saved query bookmarks and the original FCT query XML. Maestro reads and writes this Datasite.
- `gttp://ggg.maestro.ecosys/ontology-cache` — RDF documents discovered for the Categories hierarchy. Maestro reads and ingests RDF into this Datasite.

The selectable endpoint URLs are stored as RDF records in the configured Datasites registry, rather than as `Name=URL` entries in `.env.local`.

`PERSONAL_SPARQL_ENDPOINT` identifies the SPARQL HTTP endpoint used for these operations. `RDF_LOADER_USERNAME` and `RDF_LOADER_PASSWORD` are optional credentials. The endpoint path matters for Virtuoso authentication:

- `/sparql` uses Virtuoso's shared `SPARQL` service account. Supplying Basic Auth variables does not make the standard endpoint act as a different database user.
- `/sparql-auth` authenticates using the database account supplied in `RDF_LOADER_USERNAME` and `RDF_LOADER_PASSWORD`. Use this path if you want Maestro to use a dedicated account.

For example, to use a dedicated account, set `PERSONAL_SPARQL_ENDPOINT=http://localhost:8890/sparql-auth`, then fill in both credential variables. Do not put credentials directly in the endpoint URL. Restart Maestro after changing `.env.local`.

#### Virtuoso permissions (least privilege)

Virtuoso checks both the SPARQL role and the user's permission on each Datasite. Granting a role alone is not enough. Configure permissions as a Virtuoso administrator (`dba`) in Conductor at `http://localhost:8890/conductor`. See the official [SPARQL endpoint security documentation](https://docs.openlinksw.com/virtuoso/rdfsparqlprotocolendpoint/), [RDF graph-level security documentation](https://docs.openlinksw.com/virtuoso/rdfgraphsecuritylevel/), and [graph security configuration examples](https://docs.openlinksw.com/virtuoso/rdfgraphsecurityintconfsec/).

**1. Grant only the SPARQL role Maestro needs.** Maestro runs `SELECT` queries and SPARQL updates (`INSERT DATA` for bookmarks and `LOAD` for ontology ingestion). Virtuoso documents that `SPARQL_UPDATE` includes `SPARQL_SELECT`, so you do not need to grant every available role. In Conductor, go to **System Admin → User Accounts → Users → Edit** for the relevant account, set its user type to **SQL/ODBC and WebDAV** (wording may vary by Virtuoso version), add the `SPARQL_UPDATE` role, and save.

- If `PERSONAL_SPARQL_ENDPOINT` ends in `/sparql`, grant `SPARQL_UPDATE` to the built-in **`SPARQL`** service account, because that endpoint executes requests as that account. The Basic Auth username/password in `.env.local` do **not** change that identity.
- If it ends in `/sparql-auth`, grant `SPARQL_UPDATE` to the account named by `RDF_LOADER_USERNAME`; this endpoint uses those credentials to authenticate the configured account.
- If you plan to use both endpoint paths, grant the role and graph permissions to both accounts. Otherwise, configure only the account used by the endpoint path you selected. Do not give either account every available role.

**2. Grant Datasite access.** In Conductor's SQL execution interface, logged in as `dba`, run the statements for the account that actually serves requests. These permission masks are: `1` = read; `3` = read + SPARQL Update write; `7` = read + SPARQL Update write + RDF network-resource fetch (the additional bit 4 permission).

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

For `/sparql-auth`, repeat those three statements with the actual account configured as `RDF_LOADER_USERNAME` in place of `'SPARQL'` (for example, `'maestro_app'`). For example, if you intentionally use **both** endpoint paths, run the statements for `SPARQL` and again for the configured account. Do not grant either account write access to every graph. If your Datasite IRIs differ from the examples, use the exact IRIs configured by the corresponding `MAESTRO_*_GRAPH` variables.

These permissions are the minimum for Maestro's current behavior: it only reads the Datasites registry, reads/writes saved query favorites, and reads/writes the ontology cache while loading remote RDF. If you later disable ontology ingestion, the ontology Datasite permissions can be reduced accordingly.

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