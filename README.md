# Maestro (Dashboard for Virtuoso's facets API)

A web-based dashboard for exploring RDF data through Virtuoso's Faceted Browser (FCT) API. Built with Next.js, TypeScript, Tailwind CSS, and shadcn/ui.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- npm
- A reachable **Virtuoso server exposing the Faceted Browser (FCT) API** for the RDF data you want to explore. Maestro's main browsing interface depends on Virtuoso's FCT API; an arbitrary SPARQL endpoint alone is not a replacement for this.
- A reachable **personal SPARQL endpoint that permits the required reads and writes**. Maestro uses this store for its Datasites registry, query History, and ontology data. A read-only endpoint is not sufficient.
- For the setup documented below, use **Virtuoso Community Edition** as the personal SPARQL store, and have administrator access to configure the SPARQL role and per-Datasite permissions. The permission instructions and `LOAD` behavior below are Virtuoso-specific.
- Network access from the personal Virtuoso server to public ontology RDF documents if you want Maestro to ingest ontology documents into the ontology Datasite.

You can use different servers for the FCT data endpoint and the personal SPARQL store. The personal store is where Maestro keeps its own registry, History, and ontology data; it does not have to be the same server that hosts the RDF data you browse.

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

Maestro needs a writable personal SPARQL store before these features can work. At minimum, the configured endpoint/account must be able to:

- Read the Datasites registry.
- Read and write query History.
- Read and write ontology data, including loading public RDF documents if ontology ingestion is enabled.

The setup below assumes that the personal store is **Virtuoso Community Edition**. Configure the following required properties in `.env.local` (you can copy `.env.example`). The comments describe the kind of value expected; use your own file path and Datasite IRIs rather than assuming any particular graph names.

```env
# HTTP URL of the personal SPARQL endpoint Maestro uses for its registry and history/ontology data.
PERSONAL_SPARQL_ENDPOINT=

# Filesystem path to the local Turtle RDF file that describes the Datasites registry.
# Maestro reads this file at server startup and replaces the triples in SITE_SPARQL_ENDPOINTS with its contents.
SPARQL_ENDPOINTS=

# Datasite IRI (RDF graph URI) where Maestro stores the selectable Datasites registry.
SITE_SPARQL_ENDPOINTS=

# Datasite IRI (RDF graph URI) where Maestro stores query History.
SITE_HISTORY=

# Datasite IRI (RDF graph URI) used for ontology data needed by the Categories hierarchy.
SITE_ONTOLOGY=
```

`SPARQL_ENDPOINTS` is a **local filesystem path**, not a URL or graph IRI. It points to a Turtle file containing the RDF that describes the Datasites available in Maestro. `SITE_SPARQL_ENDPOINTS`, `SITE_HISTORY`, and `SITE_ONTOLOGY` are **Datasite IRIs** (RDF graph names), not file paths. Set each to the graph IRI you want Maestro to use, and use those exact same values when configuring Virtuoso permissions.

The selectable endpoint URLs are stored as RDF records in the graph named by `SITE_SPARQL_ENDPOINTS`, rather than as `Name=URL` entries in `.env.local`. **The Turtle file must contain records for the Datasites you want to select**; configuring the graph IRI does not itself register endpoint URLs. Make sure the records point to reachable Virtuoso FCT endpoints.

`PERSONAL_SPARQL_ENDPOINT` identifies the personal SPARQL HTTP endpoint used for the Datasites registry, History, and ontology operations; it is separate from the FCT endpoint URLs registered as Datasites. `RDF_LOADER_USERNAME` and `RDF_LOADER_PASSWORD` are optional credentials for the Virtuoso `/sparql-auth` endpoint. The endpoint path matters for Virtuoso authentication:

- `/sparql` uses Virtuoso's shared `SPARQL` service account. Supplying Basic Auth variables does not make the standard endpoint act as a different database user.
- `/sparql-auth` authenticates using the database account supplied in `RDF_LOADER_USERNAME` and `RDF_LOADER_PASSWORD`. Use this path if you want Maestro to use a dedicated account.

For example, to use a dedicated account, set `PERSONAL_SPARQL_ENDPOINT=http://localhost:8890/sparql-auth`, then fill in both credential variables. Do not put credentials directly in the endpoint URL. Restart Maestro after changing `.env.local`.

#### Virtuoso permissions (least privilege)

Virtuoso checks both the SPARQL role and the user's permission on each Datasite. Granting a role alone is not enough. Configure permissions as a Virtuoso administrator (`dba`) in Conductor at `http://localhost:8890/conductor`. See the official [SPARQL endpoint security documentation](https://docs.openlinksw.com/virtuoso/rdfsparqlprotocolendpoint/), [RDF graph-level security documentation](https://docs.openlinksw.com/virtuoso/rdfgraphsecuritylevel/), and [graph security configuration examples](https://docs.openlinksw.com/virtuoso/rdfgraphsecurityintconfsec/).

**1. Grant only the SPARQL role Maestro needs.** Maestro runs `SELECT` queries and SPARQL updates for its registry/History/ontology data, including `LOAD` for ontology ingestion. Virtuoso documents that `SPARQL_UPDATE` includes `SPARQL_SELECT`, so you do not need to grant every available role. In Conductor, go to **System Admin → User Accounts → Users → Edit** for the relevant account, set its user type to **SQL/ODBC and WebDAV** (wording may vary by Virtuoso version), add the `SPARQL_UPDATE` role, and save.

- If `PERSONAL_SPARQL_ENDPOINT` ends in `/sparql`, grant `SPARQL_UPDATE` to the built-in **`SPARQL`** service account, because that endpoint executes requests as that account. The Basic Auth username/password in `.env.local` do **not** change that identity.
- If it ends in `/sparql-auth`, grant `SPARQL_UPDATE` to the account named by `RDF_LOADER_USERNAME`; this endpoint uses those credentials to authenticate the configured account.
- If you plan to use both endpoint paths, grant the role and graph permissions to both accounts. Otherwise, configure only the account used by the endpoint path you selected. Do not give either account every available role.

**2. Grant Datasite access.** In Conductor's SQL execution interface, logged in as `dba`, run the statements for the account that actually serves requests. These permission masks are: `1` = read; `3` = read + SPARQL Update write; `7` = read + SPARQL Update write + RDF network-resource fetch (the additional bit 4 permission).

For the standard `/sparql` endpoint, grant permissions to the built-in `SPARQL` account. Replace each property placeholder with the **value configured for that property** in `.env.local`; do not use the property name itself as the graph IRI.

```sql
-- Datasites registry: read only; use the value of SITE_SPARQL_ENDPOINTS
DB.DBA.RDF_GRAPH_USER_PERMS_SET(
  '[value of SITE_SPARQL_ENDPOINTS]', 'SPARQL', 1
);

-- Query History: read and write; use the value of SITE_HISTORY
DB.DBA.RDF_GRAPH_USER_PERMS_SET(
  '[value of SITE_HISTORY]', 'SPARQL', 3
);

-- Ontology data: read, write, and LOAD remote RDF documents; use the value of SITE_ONTOLOGY
DB.DBA.RDF_GRAPH_USER_PERMS_SET(
  '[value of SITE_ONTOLOGY]', 'SPARQL', 7
);
```

For `/sparql-auth`, repeat these statements with the actual account configured as `RDF_LOADER_USERNAME` in place of `'SPARQL'` (for example, `'maestro_app'`). If you use both endpoint paths, run the statements for `SPARQL` and again for the configured account. Do not grant either account write access to every graph.

These permissions provide read access to the Datasites registry, read/write access to History, and read/write plus remote RDF loading access to the ontology Datasite. If Maestro's use of any Datasite changes, adjust that graph's permission mask to match the required operations.

**Using a non-Virtuoso personal SPARQL store:** the configuration variable accepts an endpoint URL, but the SQL permission commands and the remote-RDF `LOAD` instructions above are Virtuoso-specific. A different SPARQL implementation must provide equivalent write access to the configured graphs and support the ontology-ingestion behavior Maestro uses; this README does not provide setup instructions for other stores. An endpoint that only allows `SELECT`, or that blocks SPARQL Update, will not be sufficient.

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