import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { getQueryCache, queryCacheKey, setQueryCache } from "@/lib/query-cache";

//export const runtime = "nodejs";
//export const dynamic = "force-dynamic";

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: true,
});


type FctEndpoint = { id: string; label: string; url: string; group: string };

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getConfiguredEndpoints(): FctEndpoint[] {
  // Entry syntax: Group::Label=URL. Legacy Label=URL entries remain valid.
  const configured = (process.env.FCT_ENDPOINTS ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0) return null;
      const left = entry.slice(0, separator).trim();
      const url = entry.slice(separator + 1).trim();
      if (!left || !/^https?:\/\//i.test(url)) return null;
      const groupSeparator = left.indexOf("::");
      const group = groupSeparator >= 0 ? left.slice(0, groupSeparator).trim() : "Endpoints";
      const label = (groupSeparator >= 0 ? left.slice(groupSeparator + 2) : left).trim();
      if (!label) return null;
      return { id: groupSeparator >= 0 ? slugify(`${group}-${label}`) : slugify(label), group: group || "Endpoints", label, url };
    })
    .filter((endpoint): endpoint is FctEndpoint => Boolean(endpoint));

  const legacyUrl = (process.env.FCT_ENDPOINT ?? "").trim();
  if (legacyUrl && !configured.some((endpoint) => endpoint.url === legacyUrl)) {
    configured.unshift({ id: slugify("Current VOS"), group: "Endpoints", label: "Current VOS", url: legacyUrl });
  }

  const seen = new Set<string>();
  return configured.filter((endpoint) => {
    if (seen.has(endpoint.id)) return false;
    seen.add(endpoint.id);
    return true;
  });
}

function getSelectedEndpointId(request: Request, endpoints: FctEndpoint[]) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)fct_endpoint=([^;]+)/);
  const id = match ? decodeURIComponent(match[1]) : "";
  return endpoints.some((endpoint) => endpoint.id === id) ? id : endpoints[0]?.id ?? "";
}

export async function GET(request: Request) {
  const endpoints = getConfiguredEndpoints();
  const url = new URL(request.url);
  const cookie = request.headers.get("cookie") ?? "";
  const cookieMatch = cookie.match(/(?:^|;\s*)fct_endpoint=([^;]+)/);
  const cookieId = cookieMatch ? decodeURIComponent(cookieMatch[1]) : "";
  const selectedId = endpoints.some((endpoint) => endpoint.id === cookieId) ? cookieId : "";

  if (url.searchParams.get("health") !== "1") {
    return NextResponse.json({ endpoints: endpoints.map(({ id, label, url, group }) => ({ id, label, url, group })), selectedId });
  }

  const endpointId = url.searchParams.get("endpointId") ?? "";
  const endpoint = endpoints.find((item) => item.id === endpointId);
  if (!endpoint) {
    return NextResponse.json({ error: "Unknown FCT endpoint health check." }, { status: 400 });
  }

  try {
    // Use exactly the scheme configured in FCT_ENDPOINTS; never rewrite HTTP to HTTPS or vice versa.
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", Accept: "text/xml" },
      body: '<?xml version="1.0" encoding="UTF-8"?><query xmlns="http://openlinksw.com/services/facets/1.0" inference="" same-as=""><text>test</text><view type="text" limit="1" offset="0"/></query>',
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    return NextResponse.json({
      check: {
        id: endpoint.id,
        status,
        state: status >= 500 ? "server-error" : status >= 400 ? "http-error" : "ok",
        testedUrl: endpoint.url,
      },
    });
  } catch (error) {
    return NextResponse.json({
      check: {
        id: endpoint.id,
        status: null,
        state: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable",
        testedUrl: endpoint.url,
      },
    });
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (value && typeof value === "object" && "#text" in value) {
    return String((value as { "#text": unknown })["#text"] ?? "");
  }

  return "";
}

function attribute(value: unknown, name: string): string {
  if (!value || typeof value !== "object") return "";
  return String((value as Record<string, unknown>)[`@_${name}`] ?? "");
}

export async function POST(request: Request) {
  try {



const body = await request.json().catch(() => null);

if (typeof body?.selectEndpointId === "string") {
  const endpoints = getConfiguredEndpoints();
  const selected = endpoints.find((endpoint) => endpoint.id === body.selectEndpointId);
  if (!selected) {
    return NextResponse.json({ error: "Unknown FCT endpoint selection." }, { status: 400 });
  }
  const response = NextResponse.json({ selectedId: selected.id, label: selected.label });
  response.cookies.set("fct_endpoint", selected.id, { httpOnly: true, sameSite: "lax", path: "/" });
  return response;
}

const hasQueryXml = typeof body?.queryXml === "string";
const queryXml = hasQueryXml ? body.queryXml.trim() : "";

const supportedViews = new Set(["text", "properties", "properties-in", "classes", "list", "list-count", "describe"]);
const explicitView = typeof body?.view === "string" && supportedViews.has(body.view)
  ? body.view
  : "";
const xmlViewType = queryXml.match(/<view\b[^>]*\btype=["']([^"']+)["']/i)?.[1] ?? "";
const viewType = explicitView || (supportedViews.has(xmlViewType) ? xmlViewType : "text");

const propertyUri =
  typeof body?.propertyUri === "string"
    ? body.propertyUri.trim()
    : "";

let searchText = "";


if (hasQueryXml) {
  try {
    if (!queryXml) {
      throw new Error("The query XML is empty.");
    }

    const parsedQuery = parser.parse(queryXml);
    const root = parsedQuery?.query;

    if (!root || typeof root !== "object" || Array.isArray(root)) {
      throw new Error("The query XML must have a query root element.");
    }

    const queryRoot = root as Record<string, unknown>;

    const hasTextElement = /<text\b[^>]*>([\s\S]*?)<\/text>|<text\b[^>]*\/>/i.test(queryXml);
    // Virtuoso's Facets documentation explicitly allows omitting <text> to
    // disable full-text matching. Maestro normally keeps a text node in its
    // authoritative query, but count-only queries may omit an empty one so FCT
    // does not generate the placeholder bif:contains '(NULL)' pattern.
    if ((!hasTextElement && viewType !== "describe" && body?.countOnly !== true) ||
        (queryRoot.text !== undefined && typeof queryRoot.text !== "string")) {
      throw new Error("The query XML must contain a text element unless this is a count-only query or describe view.");
    }

    searchText = typeof queryRoot.text === "string" ? queryRoot.text.trim() : "";
  } catch {
    return NextResponse.json(
      { error: "Invalid query XML. A text element is required except for count-only queries and describe views." },
      { status: 400 },
    );
  }
} else {
  searchText =
    typeof body?.text === "string" ? body.text.trim() : "";
}

  
  
    const endpoints = getConfiguredEndpoints();
    const selectedEndpointId = getSelectedEndpointId(request, endpoints);
    const endpoint = endpoints.find((item) => item.id === selectedEndpointId)?.url;

    if (!endpoint) {
      return NextResponse.json(
        { error: "No FCT endpoints are configured. Add FCT_ENDPOINTS or FCT_ENDPOINT to .env.local." },
        { status: 500 },
      );
    }



const propertyFilterXml =
  viewType === "text" && propertyUri
    ? `  <property iri="${escapeXml(propertyUri)}"></property>\n`
    : "";

const outgoingQueryXml =
  queryXml && (!explicitView || viewType === "text" || viewType === "list-count" || viewType === "describe")
    ? queryXml
    : queryXml && (viewType === "properties" || viewType === "properties-in" || viewType === "classes")
      // Preserve the active query tree and switch only the requested facet view.
      ? queryXml.replace(/(<view\b[^>]*\btype=["'])[^"']*(["'])/i, `$1${viewType}$2`)
      : `<?xml version="1.0" encoding="UTF-8"?>
<query xmlns="http://openlinksw.com/services/facets/1.0" inference="" same-as="">
  <text>${escapeXml(searchText)}</text>
  ${propertyFilterXml}
  <view type="${viewType}" limit="30" offset="0"/>
</query>`;


    const cacheKey = queryCacheKey(
      "fct",
      endpoint,
      JSON.stringify({ queryXml: outgoingQueryXml, viewType, countOnly: body?.countOnly === true, graphOnly: body?.graphOnly === true }),
    );
    const cachedResult = getQueryCache<Record<string, unknown>>(cacheKey);
    if (cachedResult) return NextResponse.json(cachedResult);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        Accept: "text/xml",
      },
      body: outgoingQueryXml,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });

    const responseXml = await response.text();
console.log("Virtuoso raw XML:", responseXml.slice(0, 8000));

    if (!response.ok) {
      console.error("Virtuoso Facets HTTP error:", response.status);
      return NextResponse.json(
        { error: `Virtuoso returned HTTP ${response.status}.` },
        { status: 502 },
      );
    }

    const parsed = parser.parse(responseXml);
    const facets = parsed.facets;

    if (!facets) {
      console.error("Unexpected Virtuoso XML response.");
      return NextResponse.json(
        { error: "Virtuoso returned an unexpected XML response." },
        { status: 502 },
      );
    }

    if (facets["Error explanation"]) {
      return NextResponse.json(
        { error: textOf(facets["Error explanation"]) || "Virtuoso query failed." },
        { status: 502 },
      );
    }

    const result = facets.result;
    const rows = asArray(
      result && typeof result === "object"
        ? (result as Record<string, unknown>).row as
            | Record<string, unknown>
            | Record<string, unknown>[]
            | undefined
        : undefined,
    );
	
	
const rawRows = parsed?.facets?.result?.row;
const complete = String(parsed?.facets?.complete ?? "") === "yes";
const sparql = String(parsed?.facets?.sparql ?? "");

const normalizedRows = (
  Array.isArray(rawRows)
    ? rawRows
    : rawRows
      ? [rawRows]
      : []
) as Record<string, unknown>[];

// A lightweight graph-facet request scans the active query's full result window
// and returns only graph URIs, without building/sending full result objects.
if (body?.graphOnly === true) {
  const graphUris = new Set<string>();
  for (const row of normalizedRows) {
    const rawColumns = row["column"];
    const rawColumnList = Array.isArray(rawColumns) ? rawColumns : rawColumns ? [rawColumns] : [];
    for (const rawColumn of rawColumnList) {
      const column = normalizeColumn(rawColumn);
      const isNamedGraph = /^(g|graph|namedgraph|graphuri)$/i.test(column.name ?? "") ||
        column.attributes.graph === "g" || column.raw?.["@_graph"] === "g" ||
        /^(graph|ggg):\/\//i.test(column.value);
      if (isNamedGraph && column.value.trim()) graphUris.add(column.value.trim());
    }
  }
  const graphs = Array.from(graphUris);
  const responseData = { graphs, count: graphs.length, rowCount: normalizedRows.length, complete, sparql };
  setQueryCache(cacheKey, responseData);
  return NextResponse.json(responseData);
}

function getColumnText(column: unknown): string {
  if (typeof column === "string") {
    return column;
  }

  if (column && typeof column === "object") {
    const value = (column as Record<string, unknown>)["#text"];

    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }

  return "";
}

type FctTermType = "uri" | "literal" | "bnode";

type FctResponseColumn = {
  value: string;
  name?: string;
  shortform?: string;
  termType?: FctTermType;
  datatype?: string;
  lang?: string;
  attributes: Record<string, string>;
  raw: Record<string, unknown>;
};

function getColumnAttributes(column: unknown): Record<string, string> {
  if (!column || typeof column !== "object") return {};
  return Object.fromEntries(
    Object.entries(column as Record<string, unknown>)
      .filter(([key, value]) => key.startsWith("@_") && value !== undefined && value !== null)
      .map(([key, value]) => [key.slice(2), String(value)]),
  );
}

function getColumnName(column: unknown): string {
  const attributes = getColumnAttributes(column);
  return String(attributes.name ?? attributes.variable ?? attributes.var ?? attributes.alias ?? attributes.column ?? "").trim();
}

function getColumnTermMetadata(column: unknown): {
  termType?: FctTermType;
  datatype?: string;
  lang?: string;
} {
  if (!column || typeof column !== "object") return {};
  const record = column as Record<string, unknown>;
  const datatype = String(record["@_datatype"] ?? record["@_datatype-uri"] ?? "");
  const lang = String(record["@_xml:lang"] ?? record["@_lang"] ?? record["@_language"] ?? "");
  const explicitType = String(record["@_type"] ?? record["@_kind"] ?? "").toLowerCase();
  const normalizedDatatype = datatype.toLowerCase();
  const termType: FctTermType | undefined =
    explicitType === "bnode" || explicitType === "blank-node" || explicitType === "blanknode"
      ? "bnode"
      : (datatype && normalizedDatatype !== "uri") || lang ||
          explicitType === "literal" || explicitType === "typed-literal"
        ? "literal"
        : normalizedDatatype === "uri" || explicitType === "uri" || explicitType === "resource" || explicitType === "iri"
          ? "uri"
          : undefined;
  return {
    ...(termType ? { termType } : {}),
    ...(datatype ? { datatype } : {}),
    ...(lang ? { lang } : {}),
  };
}

function normalizeColumn(column: unknown): FctResponseColumn {
  const attributes = getColumnAttributes(column);
  const metadata = getColumnTermMetadata(column);
  const shortform = String(attributes.shortform ?? "").trim();
  const name = getColumnName(column);
  return {
    value: getColumnText(column),
    ...(name ? { name } : {}),
    ...(shortform ? { shortform } : {}),
    ...(metadata.termType ? { termType: metadata.termType } : {}),
    ...(metadata.datatype ? { datatype: metadata.datatype } : {}),
    ...(metadata.lang ? { lang: metadata.lang } : {}),
    attributes,
    raw: column && typeof column === "object"
      ? { ...(column as Record<string, unknown>) }
      : { "#text": column ?? "" },
  };
}

const parseFacetRows = () => normalizedRows
        .map((row) => {
          const rawColumns = row["column"];
          const columns = Array.isArray(rawColumns) ? rawColumns : rawColumns ? [rawColumns] : [];
          const uri = getColumnText(columns[0]);
          const countText = getColumnText(columns[1]);
          const firstColumn = columns[0];
          const shortform = firstColumn && typeof firstColumn === "object"
            ? String((firstColumn as Record<string, unknown>)["@_shortform"] ?? "")
            : "";
          return { uri, label: shortform || uri, count: Number(countText) || 0 };
        })
        .filter((item) => item.uri);

const properties =
  viewType === "properties"
    ? parseFacetRows()
    : [];

const classes =
  viewType === "classes"
    ? parseFacetRows()
    : [];

const roles =
  viewType === "properties-in"
    ? parseFacetRows()
    : [];

const listCountResults =
  viewType === "list-count"
    ? normalizedRows.map((row) => {
        const rawColumns = row["column"];
        const rawColumnList = Array.isArray(rawColumns) ? rawColumns : rawColumns ? [rawColumns] : [];
        const columns = rawColumnList.map(normalizeColumn);
        const uri = columns[0]?.value ?? "";
        const shortform = columns[0]?.shortform ?? "";
        const term = columns[0];
        return {
          uri,
          title: shortform || uri,
          ...(shortform ? { shortform } : {}),
          columns,
          matches: [] as { excerpt: string; columns: FctResponseColumn[] }[],
          ...(term?.termType ? { termType: term.termType } : {}),
          ...(term?.datatype ? { datatype: term.datatype } : {}),
          ...(term?.lang ? { lang: term.lang } : {}),
        };
      }).filter((item) => item.uri)
    : [];

const listResults = viewType === "list"
  ? normalizedRows.map((row) => {
      const rawColumns = row["column"];
      const rawColumnList = Array.isArray(rawColumns) ? rawColumns : rawColumns ? [rawColumns] : [];
      const columns = rawColumnList.map(normalizeColumn);
      const valueColumn = columns[0];
      const uri = valueColumn?.value ?? "";
      const shortform = valueColumn?.shortform ?? "";
      const label = columns[1]?.value && columns[1].value !== uri ? columns[1].value : "";
      return {
        uri,
        title: label || shortform || uri,
        ...(label ? { label } : {}),
        ...(shortform ? { shortform } : {}),
        columns,
        matches: [] as { excerpt: string; columns: FctResponseColumn[] }[],
        // FCT list views can omit explicit RDF term metadata for plain literals.
        // Do not default every such value to a URI: doing so makes group-by
        // member filters emit datatype="uri" for values like "Male" or "Gary".
        termType: valueColumn?.termType ?? (/^[a-z][a-z0-9+.-]*:/i.test(uri) ? "uri" : "literal") as FctTermType,
        ...(valueColumn?.datatype ? { datatype: valueColumn.datatype } : {}),
        ...(valueColumn?.lang ? { lang: valueColumn.lang } : {}),
      };
    }).filter((item) => item.uri)
  : [];

const describe = viewType === "describe"
  ? normalizedRows.flatMap((row) => {
      const rawColumns = row["column"];
      const columns = Array.isArray(rawColumns) ? rawColumns : rawColumns ? [rawColumns] : [];
      if (columns.length < 2) return [];
      const propertyColumn = columns.length >= 3 ? columns[1] : columns[0];
      const valueColumn = columns.length >= 3 ? columns[2] : columns[1];
      const displayColumn = (column: unknown) => {
        const value = getColumnText(column);
        if (!column || typeof column !== "object") return value;
        const record = column as Record<string, unknown>;
        const metadata = getColumnTermMetadata(column);
        const shortform = String(record["@_shortform"] ?? "").trim();
        return metadata.termType === "uri" && shortform ? shortform : value;
      };
      const property = displayColumn(propertyColumn);
      const value = displayColumn(valueColumn);
      return property ? [{ property, value }] : [];
    })
  : [];

/*
const results =
  viewType === "text"
    ? normalizedRows
        .map((row) => {
          const rawColumns = row["column"];

          const columns = Array.isArray(rawColumns)
            ? rawColumns
            : rawColumns
              ? [rawColumns]
              : [];

          const uri = getColumnText(columns[3]);
          const title = getColumnText(columns[4]);
          const excerpt = getColumnText(columns[5]);

          const termMetadata = getColumnTermMetadata(columns[3]);
          return {
            uri,
            title: title || uri,
            excerpt,
            termType: termMetadata.termType ?? "uri" as const,
            ...(termMetadata.datatype ? { datatype: termMetadata.datatype } : {}),
            ...(termMetadata.lang ? { lang: termMetadata.lang } : {}),
          };
        })
        .filter((item) => item.uri)
    : [];
*/


const rawResults =
  viewType === "text"
    ? normalizedRows
        .map((row) => {
          const rawColumns = row["column"];
          const rawColumnList = Array.isArray(rawColumns) ? rawColumns : rawColumns ? [rawColumns] : [];
          const columns = rawColumnList.map(normalizeColumn);

          // Preserve the existing FCT text-view column offsets, while retaining
          // every column so extra projections (score, rank, graph, etc.) survive.
          const valueColumn = columns[3] ?? columns[0];
          const uri = valueColumn?.value ?? "";
          const titleColumn = columns[4];
          const excerptColumn = columns[5];
          const shortform = valueColumn?.shortform ?? "";
          const label = titleColumn?.value && titleColumn.value !== uri ? titleColumn.value : "";
          const byName = (name: string) => columns.find((column) => column.name?.toLowerCase() === name);
          const score = byName("sc") ?? byName("score");
          const rank = byName("rank");
          const graph = byName("g") ?? byName("graph") ?? columns.find((column) => column.attributes.graph === "g" || column.raw?.["@_graph"] === "g");
          const termMetadata = getColumnTermMetadata(rawColumnList[3] ?? rawColumnList[0]);
          return {
            uri,
            title: label || shortform || uri,
            ...(label ? { label } : {}),
            ...(shortform ? { shortform } : {}),
            ...(graph?.value ? { graph: graph.value } : {}),
            ...(score ? { score } : {}),
            ...(rank ? { rank } : {}),
            columns,
            excerpt: excerptColumn?.value ?? "",
            termType: termMetadata.termType ?? ("uri" as const),
            ...(termMetadata.datatype ? { datatype: termMetadata.datatype } : {}),
            ...(termMetadata.lang ? { lang: termMetadata.lang } : {}),
          };
        })
        .filter((item) => item.uri)
    : [];

const groupedResults = new Map<
  string,
  {
    uri: string;
    title: string;
    label?: string;
    shortform?: string;
    graph?: string;
    score?: FctResponseColumn;
    rank?: FctResponseColumn;
    columns: FctResponseColumn[];
    matches: { excerpt: string; columns: FctResponseColumn[]; graph?: string; score?: FctResponseColumn; rank?: FctResponseColumn }[];
    termType?: FctTermType;
    datatype?: string;
    lang?: string;
  }
>();

for (const item of rawResults) {
  const resultKey = JSON.stringify([item.uri, item.termType ?? "uri", item.datatype ?? "", item.lang ?? ""]);
  const existing = groupedResults.get(resultKey);
  const match = {
    excerpt: item.excerpt,
    columns: item.columns,
    ...(item.graph ? { graph: item.graph } : {}),
    ...(item.score ? { score: item.score } : {}),
    ...(item.rank ? { rank: item.rank } : {}),
  };

  if (existing) {
    existing.matches.push(match);
    if ((!existing.label || existing.label === existing.uri) && item.label) {
      existing.label = item.label;
      existing.title = item.label;
    }
    if (!existing.shortform && item.shortform) existing.shortform = item.shortform;
  } else {
    groupedResults.set(resultKey, {
      uri: item.uri,
      title: item.title,
      ...(item.label ? { label: item.label } : {}),
      ...(item.shortform ? { shortform: item.shortform } : {}),
      ...(item.graph ? { graph: item.graph } : {}),
      ...(item.score ? { score: item.score } : {}),
      ...(item.rank ? { rank: item.rank } : {}),
      columns: item.columns,
      matches: [match],
      termType: item.termType,
      ...("datatype" in item && item.datatype ? { datatype: item.datatype } : {}),
      ...("lang" in item && item.lang ? { lang: item.lang } : {}),
    });
  }
}

const results = viewType === "list-count"
  ? listCountResults
  : viewType === "list"
    ? listResults
    : Array.from(groupedResults.values());

// Count requests are intentionally separate from the paged Results request.
// Return only the count metadata so the browser does not receive the whole set.
if (body?.countOnly === true) {
  const countResponse = { totalCount: results.length, rowCount: normalizedRows.length, complete, sparql };
  setQueryCache(cacheKey, countResponse);
  return NextResponse.json(countResponse);
}

const shortformsByUri = new Map<string, { uri: string; shortform?: string; label?: string; isNamedGraph?: boolean }>();
for (const row of normalizedRows) {
  const rawColumns = row["column"];
  const rawColumnList = Array.isArray(rawColumns) ? rawColumns : rawColumns ? [rawColumns] : [];
  const columns = rawColumnList.map(normalizeColumn);
  for (const column of columns) {
    const looksLikeUri = /^[a-z][a-z0-9+.-]*:/i.test(column.value);
    if (column.termType === "literal" || !column.value || (column.termType !== "uri" && !column.shortform && !looksLikeUri)) continue;
    const prior = shortformsByUri.get(column.value) ?? { uri: column.value };
    if (column.shortform && column.shortform !== column.value) prior.shortform = column.shortform;
    if (/^(g|graph|namedgraph|graphuri)$/i.test(column.name ?? "") || column.attributes.graph === "g" || column.raw?.["@_graph"] === "g") prior.isNamedGraph = true;
    if (/^(graph|ggg):\/\//i.test(column.value)) prior.isNamedGraph = true;
    shortformsByUri.set(column.value, prior);
  }
  if (viewType === "text" || viewType === "list") {
    const subject = viewType === "text" ? (columns[3] ?? columns[0]) : columns[0];
    const label = (viewType === "text" ? columns[4] : columns[1])?.value?.trim() ?? "";
    if (subject && subject.termType !== "literal" && subject.value && /^[a-z][a-z0-9+.-]*:/i.test(subject.value) && label && label !== subject.value) {
      const prior = shortformsByUri.get(subject.value) ?? { uri: subject.value };
      prior.label = label;
      if (subject.shortform && subject.shortform !== subject.value) prior.shortform = subject.shortform;
      shortformsByUri.set(subject.value, prior);
    }
  }
}
const shortforms = Array.from(shortformsByUri.values());

const responseData = {
  shortforms,
  // Query-specific graph choices: only named graphs witnessed in this FCT response,
  // not the persistent all-time graph history.
  graphs: shortforms.filter((item) => item.isNamedGraph).map((item) => item.uri),
  results,
  describe,
  properties,
  classes,
  roles,
  distinctCount: viewType === "list-count" ? listCountResults.length : undefined,
  count:
    viewType === "properties"
      ? properties.length
      : viewType === "classes"
        ? classes.length
        : viewType === "properties-in"
          ? roles.length
          : viewType === "describe"
            ? describe.length
            : results.length,
  matchCount: viewType === "list" ? listResults.length : rawResults.length,
  complete,
  sparql,
};
setQueryCache(cacheKey, responseData);
return NextResponse.json(responseData);

  } catch (error) {
    console.error("Facets API error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.name === "TimeoutError"
              ? "Virtuoso timed out. Try again."
              : error.message
            : "Could not contact Virtuoso.",
      },
      { status: 500 },
    );
  }
}