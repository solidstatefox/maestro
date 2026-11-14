/**
 * One Record SELECT projection used by Browse session 0 and pivot sessions.
 * The endpoint returns RDF terms, never HTML. Both the default table and
 * graph-stored formatters consume the same immutable FCT DESCRIBE snapshot.
 */
import { cachedFetchFct } from "@/lib/client-query-cache";
import { proxyDebugHeaders } from "@/lib/proxy-debug";
import type { RdfTermKind, RecordValueTerm } from "@/lib/bnode";

export type RecordDescriptionRequest = {
  queryXml: string;
  value: string;
  termType: Exclude<RdfTermKind, "bnode">;
  datatype?: string;
  lang?: string;
  focusPredicate?: string;
  graphs?: readonly string[];
  limit: number;
  preferredLanguage: string;
  signal: AbortSignal;
};

export type RecordDescriptionResponse = {
  rows: RecordValueTerm[];
  xml: string;
  incomplete: boolean;
  query: string;
  debug: string;
};

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

type Binding = { type: string; value: string; datatype?: string; "xml:lang"?: string };
type Result = { error?: string; query?: string; incomplete?: boolean;
  results?: { bindings?: Array<Record<string, Binding>> } };

export async function loadRecordDescription(request: RecordDescriptionRequest): Promise<RecordDescriptionResponse> {
  const { queryXml, value, termType, datatype, lang, focusPredicate, graphs, limit,
    preferredLanguage, signal } = request;
  const select = {
    queryXml, iri: value, termType,
    ...(focusPredicate ? { focusPredicate } : {}),
    ...(datatype && datatype !== "string" && termType === "literal" ? { datatype } : {}),
    ...(lang ? { lang } : {}), limit, preferredLanguage,
    ...(graphs?.length ? { graphs: [...graphs] } : {}),
  };
  const response = await cachedFetchFct("/proxy/api/sparql", {
    method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-select-language", "RecordDescription") },
    body: JSON.stringify({ recordSelect: select }),
  });
  const data = await response.json() as Result;
  if (!response.ok) throw new Error(data.error || "Record SELECT failed.");
  const triples: Array<{ subject: string; predicate: string; object: string; objectType: RdfTermKind; datatype?: string; lang?: string }> = [];
  const rows: RecordValueTerm[] = [];
  for (const binding of data.results?.bindings ?? []) {
    const subject = binding.subject, predicate = binding.predicate, object = binding.object;
    if (!subject?.value || !predicate?.value || !object?.value) continue;
    const objectType: RdfTermKind = object.type === "uri" ? "uri" : object.type === "bnode" ? "bnode" : "literal";
    const objectValue = objectType === "bnode" ? (object.value.startsWith("_:") ? object.value : `_:${object.value}`) : object.value;
    triples.push({ subject: subject.value, predicate: predicate.value, object: objectValue, objectType,
      ...(object.datatype ? { datatype: object.datatype } : {}),
      ...(object["xml:lang"] ? { lang: object["xml:lang"] } : {}) });
    const matchesObject = object.value === value &&
      (termType === "uri" ? object.type === "uri" :
       object.type === "literal" && (object["xml:lang"] ?? "").toLowerCase() === (lang ?? "").toLowerCase() &&
       (!datatype || !object.datatype || object.datatype === datatype));
    const direction: RecordValueTerm["direction"] | null = termType === "uri" && subject.value === value
      ? "property" : matchesObject ? "property-of" : null;
    if (!direction) continue;
    rows.push({ property: predicate.value, value: direction === "property" ? objectValue : subject.value,
      direction, termType: direction === "property" ? objectType : "uri",
      ...(direction === "property" && object.datatype ? { datatype: object.datatype } : {}),
      ...(direction === "property" && object["xml:lang"] ? { lang: object["xml:lang"] } : {}) });
  }
  const uniqueTriples = [...new Map(triples.map(t => [[t.subject,t.predicate,t.object,t.objectType,t.datatype??"",t.lang??""].join("\u0000"),t])).values()];
  const uniqueRows = [...new Map(rows.map(r => [[r.direction,r.property,r.value,r.termType,r.datatype??"",r.lang??""].join("\u0000"),r])).values()];
  const incomplete = Boolean(data.incomplete) || uniqueTriples.length >= limit;
  const fctNs = "http://openlinksw.com/services/facets/1.0/";
  const triplesXml = uniqueTriples
    .filter(t => termType === "uri" ? t.subject === value || t.object === value : t.object === value)
    .map(t => `<fct:row><fct:column termType="uri">${escapeXml(t.subject)}</fct:column><fct:column termType="uri">${escapeXml(t.predicate)}</fct:column><fct:column termType="${escapeXml(t.objectType)}"${t.datatype ? ` datatype="${escapeXml(t.datatype)}"` : ""}${t.lang ? ` xml:lang="${escapeXml(t.lang)}"` : ""}>${escapeXml(t.object)}</fct:column></fct:row>`).join("");
  return { rows: uniqueRows, xml: `<fct:facets xmlns:fct="${fctNs}"><fct:complete>${incomplete ? "no" : "yes"}</fct:complete><fct:result type="describe">${triplesXml}</fct:result></fct:facets>`,
    incomplete, query: data.query ?? "Record SELECT query unavailable.",
    debug: `POST /proxy/api/sparql\n${JSON.stringify({ recordSelect: { iri: value, termType, datatype, lang, limit, preferredLanguage, graphs: graphs ?? [] } }, null, 2)}` };
}
