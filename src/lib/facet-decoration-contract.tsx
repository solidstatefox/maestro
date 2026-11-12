"use client";

import { useSyncExternalStore } from "react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";

/** Provider contract: no native facet knows which perspective supplied these
 * decorations. A provider's XSLT chooses a facet by direction + predicate IRI,
 * and chooses each item by its underlying RDF lexical value (never its label).
 * The TSX facet exposes only two neutral insertion slots. */
type Decoration = { icon: string; action: string; label: string; selected: boolean; colors: Map<string, string> };
type Snapshot = { source: string; facets: Map<string, Decoration>; onAction?: (action: string, facetKey: string) => void };
const EMPTY: Snapshot = { source: "", facets: new Map() };
const supportedFacetDecorationIcons = new Set<string>(iconNames);
let snapshot = EMPTY;
let publishGeneration = 0;
const listeners = new Set<() => void>();
const facetKey = (direction: string, iri: string) => `${direction}|${iri}`;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => snapshot;
function publish(value: Snapshot) { snapshot = value; listeners.forEach(listener => listener()); }
export function resetFacetDecorations(source: string) { publishGeneration++; if (snapshot.source === source) publish(EMPTY); }
const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export type DecorationFacet = { iri: string; direction: "forward" | "reverse" | "class"; items: { value: string; color: string }[] };
/** Execute the provider's actual XSLT. Neither controls nor bars are inferred
 * in React: absent XSLT output means no decoration appears. */
export async function publishXsltFacetDecorations(source: string, stylesheet: string, facets: DecorationFacet[], activeFacetKey: string, onAction: Snapshot["onAction"]): Promise<void> {
  const generation = ++publishGeneration;
  const split = activeFacetKey.indexOf("|");
  const direction = split < 0 ? "" : activeFacetKey.slice(0, split);
  const iri = split < 0 ? "" : activeFacetKey.slice(split + 1);
  const xml = `<context mode="facets" colorDirection="${escapeAttr(direction)}" colorIri="${escapeAttr(iri)}"><facets>${facets.map(facet =>
    `<facet direction="${facet.direction}" iri="${escapeAttr(facet.iri)}">${facet.items.map(item =>
      `<item value="${escapeAttr(item.value)}" color="${escapeAttr(item.color)}"/>`).join("")}</facet>`).join("")}</facets></context>`;
  const output = await transformWithMaestroSaxon(stylesheet, xml);
  const parsed = new DOMParser().parseFromString(output, "application/xml");
  if (parsed.querySelector("parsererror")) throw new Error("Facet decoration XSLT returned invalid XML.");
  const rules = new Map<string, Decoration>();
  for (const element of Array.from(parsed.getElementsByTagName("facet-decoration"))) {
    const direction = element.getAttribute("direction") ?? "";
    const iri = element.getAttribute("iri") ?? "";
    if (!iri || !["class", "forward", "reverse"].includes(direction)) continue;
    const control = element.getElementsByTagName("control")[0];
    if (!control) continue;
    const colors = new Map<string, string>();
    for (const item of Array.from(element.getElementsByTagName("item-decoration"))) {
      const color = item.getAttribute("color") ?? "";
      if (/^#[0-9a-f]{6}$/i.test(color)) colors.set(item.getAttribute("value") ?? "", color);
    }
    rules.set(facetKey(direction, iri), { icon: control.getAttribute("icon") ?? "", action: control.getAttribute("action") ?? "", label: control.getAttribute("label") ?? "Provider action", selected: control.getAttribute("selected") === "true", colors });
  }
  // A superseded Saxon transformation must never re-enable a stale legend.
  if (generation === publishGeneration) publish({ source, facets: rules, onAction });
}
/** Stable XSLT-defined header action; the underlying facet is still native and
 * the action is delegated back to its provider runtime. */
export function FacetDecorationControl({ direction, iri }: { direction: "class" | "forward" | "reverse"; iri: string }) {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const rule = current.facets.get(facetKey(direction, iri));
  if (!rule?.action || !current.onAction) return null;
  return <button type="button" title={rule.label} aria-label={rule.label} aria-pressed={rule.selected}
    onClick={() => current.onAction?.(rule.action, facetKey(direction, iri))}
    className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 ${rule.selected ? "border-sky-300 bg-sky-200 text-sky-800 hover:bg-sky-200 hover:text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100 dark:hover:bg-sky-900/70 dark:hover:text-sky-100" : ""}`}>
    <DynamicIcon name={(supportedFacetDecorationIcons.has(rule.icon) ? rule.icon : "puzzle") as IconName} className="size-4" aria-hidden="true"/>
  </button>;
}
/** Neutral per-item slot: XSLT supplies the color for exact RDF values. */
export function FacetItemDecoration({ direction, iri, value }: { direction: "class" | "forward" | "reverse"; iri: string; value: string }) {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const color = current.facets.get(facetKey(direction, iri))?.colors.get(value);
  return color ? <span aria-hidden="true" className="w-1 shrink-0 self-stretch rounded-sm" style={{ backgroundColor: color, minHeight: 18 }}/> : null;
}
