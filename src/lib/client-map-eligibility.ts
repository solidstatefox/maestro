"use client";
import { compileProviderXsltQuery } from "@/lib/provider-xslt-query";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import type { MapProviderDefinition } from "@/lib/map-provider-discovery";

/** A provider's declared mui:accepts shape and own XSLT determine its
 * geographic eligibility. Generic Maestro code does not list geo predicates.
 * A successful contextual History SHACL report is NOT provider eligibility. */
export async function hasMapProviderInput(
  provider: MapProviderDefinition, queryXml: string, signal: AbortSignal,
): Promise<boolean> {
  const doc = new DOMParser().parseFromString(queryXml, "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement?.localName !== "query")
    throw new Error("Map eligibility requires a valid FCT query.");
  const addr = doc.documentElement.getAttribute("addr") ?? "";
  if (!addr.includes("@")) throw new Error("Map eligibility requires an FCT graph address.");
  const generated = await compileProviderXsltQuery(queryXml, provider.shapeUri, provider.queryStylesheet, signal);
  // Provider XSLT supplies its own bounded SELECT; only lower its existing cap
  // for the eligibility probe, without changing predicates or FCT scope.
  const probe = generated.sparql.replace(/\bLIMIT\s+\d+\s*$/i, "LIMIT 1");
  const response = await maestroQueryFetch("/proxy/api/sparql", {
    method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json", "x-maestro-debug-source": "maps-input-shacl" },
    body: JSON.stringify({ addr, query: probe }),
  });
  const payload = await response.json() as {error?:string;results?:{bindings?:unknown[]};incomplete?:boolean};
  if (!response.ok || payload.error) throw new Error(payload.error || `Map SHACL input probe HTTP ${response.status}`);
  if (payload.incomplete) throw new Error("Map input validation was incomplete.");
  return Array.isArray(payload.results?.bindings) && payload.results!.bindings!.length > 0;
}
