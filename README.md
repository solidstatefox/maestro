# Maestro (graph browswer)

A web dashboard for exploring RDF data through Virtuoso's Faceted Browser (FCT) API, built with Next.js, TypeScript, Tailwind CSS, and shadcn/ui.

## Prerequisites

- [Node.js](https://nodejs.org/) LTS and npm
- A reachable Maestro proxy server exposing [Virtuoso's FCT API](https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs)
- A writable personal graph server for Maestro's graphsite registry, history, ontology data, etc.

The permission setup below is for Virtuoso Community Edition.

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

### 3. Configure the personal graph server and graphsite

Copy `.env.example` to `.env.local` and fill in the required values, following the comments:

```env
```env
PERSONAL_SPARQL_ENDPOINT
RDF_LOADER_USERNAME
RDF_LOADER_PASSWORD
```

For `/sparql`, Virtuoso uses its built-in `SPARQL` account. For `/sparql-auth`, it uses `RDF_LOADER_USERNAME` and `RDF_LOADER_PASSWORD`. Set these optional credentials if using `/sparql-auth`, then restart Maestro after editing `.env.local`.

#### Virtuoso permissions

In Virtuoso Conductor (`http://localhost:8890/conductor`), log in as `dba` and grant the account used by your endpoint the `SPARQL_UPDATE` role. This role includes `SPARQL_SELECT`.

Run the following SQL for the built-in `SPARQL` account when using `/sparql`. Replace each placeholder with the corresponding graph IRI from `./graph/manifest.json`:

```sql
DB.DBA.RDF_GRAPH_USER_PERMS_SET('[value of SITE_SPARQL_ENDPOINTS]', 'SPARQL', 1);
DB.DBA.RDF_GRAPH_USER_PERMS_SET('[value of SITE_HISTORY]', 'SPARQL', 3);
DB.DBA.RDF_GRAPH_USER_PERMS_SET('[value of SITE_SHAPES]', 'SPARQL', 3);
DB.DBA.RDF_GRAPH_USER_PERMS_SET('[value of SITE_ONTOLOGY]', 'SPARQL', 7);
```

Permission masks: `1` = read, `3` = read/write, `7` = read/write plus permission to fetch remote RDF for ontology loading. For `/sparql-auth`, replace `'SPARQL'` with the configured `RDF_LOADER_USERNAME`. Grant only the permissions needed for these graphs.

See the official [SPARQL endpoint security documentation](https://docs.openlinksw.com/virtuoso/rdfsparqlprotocolendpoint/), [RDF graph-level security documentation](https://docs.openlinksw.com/virtuoso/rdfgraphsecuritylevel/), and [graph security configuration examples](https://docs.openlinksw.com/virtuoso/rdfgraphsecurityintconfsec/).

Do not commit `.env.local` or private credentials to Git.

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