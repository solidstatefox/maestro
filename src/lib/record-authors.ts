"use client";

import { fctProjectPage, type Projection } from "@/lib/fct-client";
import type { RecordGraphAuthor } from "@/canvas/right/record";
import { ALL_GRAPHS } from "@/lib/graph-address-mode";

const PREDICATES = [
  "http://purl.org/dc/terms/creator",
  "http://www.w3.org/ns/prov#wasAttributedTo",
  "https://schema.org/creator",
  "http://schema.org/creator",
] as const;
const PROJECTIONS: Projection[] = PREDICATES.map(property => ({ property, direction: "forward" }));
const validIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * Graph authorship is metadata about graph IRIs already marshalled by FCT.
 * Project four known RDF predicates on those graph resources through the
 * existing /fct list-values transport. No second graph-membership scan and
 * no bespoke record-graphs HTTP handler.
 */
export async function readRecordGraphAuthors(
  addr: string, graphs: readonly string[], signal?: AbortSignal,
): Promise<RecordGraphAuthor[]> {
  const at = addr.indexOf("@");
  if (at < 0 || !addr.slice(at + 1).trim()) throw new Error("Record query has no graph server.");
  const selected = [...new Set(graphs.filter(validIri))];
  if (selected.length > 500) throw new Error("Too many graph authorship candidates.");
  if (!selected.length) return [];
  // A root FCT list-values focus, not the Browse query's selection: graph IRIs
  // are the resources whose authorship triples we need to project.
  const xml = `<query xmlns="http://openlinksw.com/services/facets/1.0" addr="${xmlEscape(`${ALL_GRAPHS}@${addr.slice(at + 1).trim()}`)}"><view type="list" limit="${selected.length}" offset="0"/></query>`;
  const records = await fctProjectPage(xml, selected, PROJECTIONS, signal);
  const authors: RecordGraphAuthor[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const predicate of PREDICATES) {
      for (const term of record.properties.get(predicate) ?? []) {
        if (!term.value || term.value === "-") continue;
        const key = `${record.uri}\0${predicate}\0${term.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          authors.push({ graph: record.uri, predicate, author: term.value });
        }
      }
    }
  }
  return authors;
}
