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

### 3. Configure SPARQL Endpoints

The application uses `SPARQL_ENDPOINTS` to define the SPARQL endpoints available in the dashboard. Maestro also supports a separate personal SPARQL endpoint for RDF loading and ontology metadata used by the Categories facet.

Create a `.env.local` file in the project root and configure the endpoints and, if needed, the optional credentials:

```env
SPARQL_ENDPOINTS=Local Virtuoso=http://localhost:8890/sparql;Featured::DBpedia=https://dbpedia.org/sparql;Featured::Wikidata=https://query.wikidata.org/sparql

# Personal SPARQL endpoint used to load RDF and query ontology metadata for Categories.
# For a local Virtuoso installation, this is commonly http://localhost:8890/sparql.
PERSONAL_SPARQL_ENDPOINT=http://localhost:8890/sparql

# Optional Basic Auth credentials for RDF loading and personal SPARQL requests.
# Leave unset if the endpoint does not require Basic Authentication.
# RDF_LOADER_USERNAME=
# RDF_LOADER_PASSWORD=

# Datasite where Maestro ingests discovered class/ontology RDF for Categories.
MAESTRO_ONTOLOGY_GRAPH=gttp://ggg.maestro.eco/ontology-cache
```

#### Personal endpoint and ontology settings

- `PERSONAL_SPARQL_ENDPOINT` is separate from `SPARQL_ENDPOINTS`. It identifies the personal SPARQL endpoint Maestro uses to load RDF and query ontology metadata for the Categories facet. For a local Virtuoso server, the usual value is `http://localhost:8890/sparql`.
- `RDF_LOADER_USERNAME` and `RDF_LOADER_PASSWORD` are optional Basic Authentication credentials used for RDF loading and requests to the personal SPARQL endpoint. Set both only when your endpoint requires Basic Authentication.
- `MAESTRO_ONTOLOGY_GRAPH` identifies the graph (datasite) where Maestro stores discovered class and ontology RDF used by Categories. The example uses `gttp://ggg.maestro.eco/ontology-cache`; change it if you want to use a different graph URI.

The personal endpoint is configured independently of the selectable endpoints in `SPARQL_ENDPOINTS`. If you change `.env.local`, restart the development server for the new configuration to take effect.

#### Endpoint format

Each endpoint follows the format:

`Name=URL`

- Separate endpoints with semicolons (`;`).
- Use a descriptive name for each endpoint.
- Use `::` in a name to separate its category from the endpoint name.
- Spaces and parentheses are allowed in endpoint names.
- Do not wrap the value in double quotes.
- Add or remove endpoints as needed.

For example:

- `Local Virtuoso=http://localhost:8890/sparql` adds a local endpoint named `Local Virtuoso`.
- `Featured::DBpedia=https://dbpedia.org/sparql` adds DBpedia under the `Featured` category.
- `Featured::URIBurner (UB)=https://linkeddata.uriburner.com/sparql` adds URIBurner under the `Featured` category, using `URIBurner (UB)` as its display name.

Endpoint names without `::` appear as standalone endpoints. Names containing `::` use the text before `::` as the category and the text after it as the endpoint name.

Make sure each endpoint URL is correct and accessible from your environment. The local example assumes Virtuoso is running on port `8890` with the SPARQL service available at `/sparql`.

Restart the development server after changing `.env.local` so the updated configuration takes effect.

**Note:** Environment variables are loaded when the development server starts. Restart the server after changing `.env.local`.

**Security:** Do not commit `.env.local` or other files containing private configuration or secrets to Git.

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