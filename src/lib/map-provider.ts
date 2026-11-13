"use client";

import { loadPersonalAuthSession } from "@/lib/personal-auth";
import { featuresGraph } from "@/lib/graph-context";
import { fctRead, fctProjectPage, type Projection } from "@/lib/fct-client";
import type { MapProviderDefinition } from "@/lib/map-provider-discovery";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const safeIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);

/** Map provider discovery through the regular FCT results + list-values path. */
export async function discoverMapProvider(signal?: AbortSignal): Promise<MapProviderDefinition | null> {
  const session = await loadPersonalAuthSession();
  if (!session) return null;
  const { graph, personalEndpointUrl } = featuresGraph(session, "policies");
  const xml = `<query xmlns="http://openlinksw.com/services/facets/1.0" addr="${esc(`${graph}@${personalEndpointUrl}`)}"><class iri="${MUI}Provider"/><property iri="${MUI}widget"><class iri="${MUI}PerspectiveWidget"/></property><view type="list" limit="100" offset="0"/></query>`;
  const found = await fctRead(xml, signal);
  if (found.incomplete) throw new Error("Map provider FCT discovery was incomplete.");
  const uris = found.results.map(r => r.uri).filter(safeIri);
  if (!uris.length) return null;
  const columns: Projection[] = [
    { property: `${RDFS}label`, direction: "forward" },
    { property: `${MUI}icon`, direction: "forward" },
    { property: `${MUI}accepts`, direction: "forward" },
  ];
  const templates = [
    ["stylesheet", `${MUI}widget`],
    ["queryStylesheet", `${MUI}queryTemplate`],
    ["resultStylesheet", `${MUI}resultTemplate`],
    ["paletteStylesheet", `${MUI}paletteTemplate`],
  ] as const;
  for (const [,predicate] of templates)
    columns.push({ property: predicate, direction: "forward", path: [predicate, `${MUI}templateContent`] });
  const records = await fctProjectPage(xml, uris, columns, signal);
  // Both forms are legal in SHACL provider definitions. Use the canonical
  // templateContent first; only pay for the rdf:value projection when needed.
  const legacyCandidates = records.filter(record => templates.some(([,predicate]) =>
    !(record.properties.get(predicate)?.[0]?.value)));
  if (legacyCandidates.length) {
    const legacy = await fctProjectPage(xml, legacyCandidates.map(item => item.uri),
      templates.map(([,predicate]) => ({property: predicate, direction: "forward" as const,
        path: [predicate, `${RDF}value`]})), signal);
    const byUri = new Map(legacy.map(item => [item.uri, item]));
    for (const record of records) {
      const fallback = byUri.get(record.uri);
      if (!fallback) continue;
      for (const [,predicate] of templates) {
        if (!record.properties.get(predicate)?.[0]?.value && fallback.properties.get(predicate)?.length)
          record.properties.set(predicate, fallback.properties.get(predicate)!);
      }
    }
  }
  const first = (record: typeof records[number], predicate: string) => record.properties.get(predicate)?.[0]?.value ?? "";
  for (const record of records) {
    const values = Object.fromEntries(templates.map(([key]) => [key, ""])) as Record<(typeof templates)[number][0], string>;
    for (const [key, predicate] of templates) values[key] = first(record, predicate);
    if (Object.values(values).every(v => v && v.length <= 250000)) {
      const shapeUri = first(record, `${MUI}accepts`);
      if (!shapeUri) continue;
      return { uri: record.uri, label: first(record, `${RDFS}label`) || "Map", icon: first(record, `${MUI}icon`) || "map-pin",
        kind: "map", shapeUri, ...values };
    }
  }
  return null;
}
