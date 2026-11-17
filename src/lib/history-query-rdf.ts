"use client";
/** Materialize the authoritative FCT XML of a History visit as a bounded, linked
 * RDF tree in the SAME personal History graph. FCT XML remains authoritative.
 * This is browser-domain code; /proxy/api/sparql only transports RDF updates. */
import { XMLParser } from "fast-xml-parser";

export const VFCT = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const BOOKMARK = "http://www.w3.org/2002/01/bookmark#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const iriRe = /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i;
const iri = (s: string) => { if (!iriRe.test(s) || s.length > 4096) throw new Error("Invalid History RDF IRI"); return `<${s}>`; };
const lit = (s: string) => JSON.stringify(s);
export type HistoryQueryProjection = { root: string; statements: string[] };
/** Child/attribute identifiers are deterministic per History item, not global. */
export function historyQueryRdf(historyId: string, xml: string): HistoryQueryProjection {
  iri(historyId);
  if (!xml || xml.length > 100_000) throw new Error("A bounded FCT query is required for History RDF.");
  const parsed = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_",
    trimValues: false, processEntities: true }).parse(xml.replace(/^\s*<\?xml\b[\s\S]*?\?>\s*/i, "")) as Record<string, unknown>[];
  if (!Array.isArray(parsed) || !parsed.some(item => Object.hasOwn(item, "query")))
    throw new Error("The History query must have an FCT <query> root.");
  const root = `${historyId}/query`;
  const statements: string[] = [
    `${iri(historyId)} <${BOOKMARK}recalls> ${iri(root)} .`,
    `${iri(root)} <${RDF}value> ${lit(xml)} .`,
  ];
  let n = 0;
  const walk = (entries: Record<string, unknown>[], parent?: string) => {
    for (const entry of entries) {
      const name = Object.keys(entry).find(key => key !== ":@" && key !== "#text" && !key.startsWith("?"));
      if (!name) continue;
      if (!/^[a-z][\w.-]*$/i.test(name)) throw new Error("Invalid XML element name in History query.");
      if (++n > 1000) throw new Error("History RDF query exceeds 1000 XML elements.");
      const subject = parent ? `${historyId}/query/node-${n}` : root;
      statements.push(`${iri(subject)} <${RDF}type> ${iri(`${VFCT}${name}`)} .`);
      statements.push(`${iri(subject)} <${RDFS}label> ${lit(name)} .`);
      if (parent) statements.push(`${iri(parent)} <${VFCT}child> ${iri(subject)} .`);
      const attributes = entry[":@"] && typeof entry[":@"] === "object" ? entry[":@"] as Record<string, unknown> : {};
      let a = 0;
      for (const [key, raw] of Object.entries(attributes)) {
        const attr = key.replace(/^@_/, "");
        if (attr === "xmlns" || attr.startsWith("xmlns:")) continue;
        if (String(raw ?? "").length > 50_000) throw new Error("Oversized FCT attribute.");
        const attribute = `${subject}/attr-${++a}`;
        statements.push(`${iri(subject)} <${VFCT}attribute> ${iri(attribute)} .`);
        statements.push(`${iri(attribute)} <${RDF}type> <${VFCT}XMLAttribute> .`);
        statements.push(`${iri(attribute)} <${RDFS}label> ${lit(`${attr}: ${String(raw ?? "")}`)} .`);
        statements.push(`${iri(attribute)} <${RDF}value> ${lit(String(raw ?? ""))} .`);
      }
      const children = Array.isArray(entry[name]) ? entry[name] as Record<string, unknown>[] : [];
      const text = children.filter(child => Object.hasOwn(child, "#text")).map(child => String(child["#text"] ?? "")).join("");
      if (text.trim()) statements.push(`${iri(subject)} <${RDF}value> ${lit(text)} .`);
      walk(children.filter(child => !Object.hasOwn(child, "#text")), subject);
    }
  };
  walk(parsed);
  if (statements.join("\n").length > 1_500_000) throw new Error("History query RDF exceeds the safe update size.");
  return { root, statements };
}
