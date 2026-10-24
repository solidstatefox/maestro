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

The application uses the `SPARQL_ENDPOINTS` environment variable to define the SPARQL endpoints available in the dashboard.

Create a `.env.local` file in the project root and add your endpoints:

```env
SPARQL_ENDPOINTS=Local Virtuoso=http://localhost:8890/sparql;Featured::DBpedia=https://dbpedia.org/sparql;Featured::Wikidata=https://query.wikidata.org/sparql
```

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