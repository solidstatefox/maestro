"use client";

/**
 * Shadcn component support for XSLT-produced Record HTML.
 * The policy stylesheet owns all data extraction and component composition.
 * The generated registry owns the actual React implementations.
 *
 * This intentionally does not evaluate JavaScript, event-handler strings,
 * or arbitrary modules from the RDF/XSLT input. Existing mui:action is
 * retained as a DOM attribute for Maestro's established action dispatcher.
 */
import { createElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ReactPortal } from "react";
import * as maplibregl from "maplibre-gl";
import { maestroComponentRegistry } from "@/components/generated/maestro-component-registry";
import { RecordValuePages } from "@/components/ui/record-value-pages";

const SCALAR_NUMBERS = new Set([
  "zoom", "longitude", "latitude", "minZoom", "maxZoom", "bearing", "pitch",
  "duration", "delay", "count", "pageSize", "maxPageSize", "step", "min", "max", "value", "defaultValue",
]);
const SCALAR_BOOLEANS = new Set([
  "disabled", "checked", "defaultChecked", "open", "defaultOpen", "required",
  "showZoom", "showCompass", "showFullscreen", "closeButton", "asChild", "modal",
  "loop", "multiple", "readOnly", "autoFocus", "inset", "collapsible", "pageSizeSelect",
]);
const JSON_PROPERTIES = new Set(["center", "bounds", "padding", "offset", "position"]);
const BLOCKED_ATTRIBUTES = /^(?:on[A-Za-z]|srcDoc$|dangerouslySetInnerHTML$|ref$|key$)/i;
const ALLOWED_URL = /^(?:https?:\/\/|\/(?!\/)|#|\?)/i;
// A formatter's custom component tag is the immutable blueprint for a React
// portal. React Strict Mode replays effects on the same DOM nodes; after the
// first mount their original children are gone. Keep those children per DOM
// host so replaying the effect cannot turn RecordValuePages into empty rows.
// WeakMap entries disappear with the replaced/discarded Record DOM tree.
const portalChildBlueprints = new WeakMap<Element, readonly ReactNode[]>();

const PROP_ALIASES: Record<string,string> = {
  class: "className", classname: "className", pagesize: "pageSize",
  maxpagesize: "maxPageSize", pagesizeselect: "pageSizeSelect",
  filterlabel: "filterLabel", listtag: "listTag", listclassname: "listClassName", tabindex: "tabIndex", for: "htmlFor",
  showzoom: "showZoom", showcompass: "showCompass", showfullscreen: "showFullscreen",
  closebutton: "closeButton", defaultopen: "defaultOpen", defaultchecked: "defaultChecked",
  readonly: "readOnly", autofocus: "autoFocus", aschild: "asChild",
  // SVG names are dashed in XML/XSLT but must be camelCase when React owns
  // the rendered element. This normalization applies only at the React host;
  // the RDF stylesheet and DOM serialization keep valid SVG names.
  "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin", "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset", "stroke-miterlimit": "strokeMiterlimit",
  "fill-rule": "fillRule", "clip-rule": "clipRule", "clip-path": "clipPath",
  "stop-color": "stopColor", "stop-opacity": "stopOpacity",
  "fill-opacity": "fillOpacity", "stroke-opacity": "strokeOpacity",
};

function safeProperty(name: string, value: string): [string, unknown] | null {
  if (BLOCKED_ATTRIBUTES.test(name)) return null;
  if ((name === "href" || name === "src") && !ALLOWED_URL.test(value)) return null;
  if (name.startsWith("mui:") && name !== "mui:action") return null;
  if (name === "mui:action") return [name, value];
  const key = PROP_ALIASES[name.toLowerCase()] ?? name;
  if (SCALAR_BOOLEANS.has(key)) return [key, value === "" || value === "true" || value === "1"];
  if (SCALAR_NUMBERS.has(key)) {
    const number = Number(value);
    return Number.isFinite(number) ? [key, number] : null;
  }
  if (JSON_PROPERTIES.has(key)) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length <= 16 && parsed.every((part) => typeof part === "number" && Number.isFinite(part))) return [key, parsed];
    } catch { /* Invalid typed props are ignored, never evaluated. */ }
    return null;
  }
  if (key === "style") return null; // No arbitrary executable style objects from RDF.
  return [key, value];
}

function componentFor(node: Element) {
  // HTML parsing folds <Button> and <button> to the same localName. Native
  // <button> controls emitted by a Record XSLT must remain DOM buttons: using
  // one as a portal host for the registered shadcn Button renders a SECOND
  // <button> inside it (and duplicates its id), which React rejects during
  // hydration. Only custom component tags are eligible for portal mounting.
  // Provider-authored native buttons already retain their attributes and the
  // existing delegated data-maestro-* click handlers.
  if (node.localName.toLowerCase() === "button") return null;
  // Record values are primary content, not a decorative async widget. Mount
  // their lightweight renderer immediately: an unresolved dynamic import left
  // the XSLT portal host blank after its original child nodes were removed.
  if (node.localName.toLowerCase() === "recordvaluepages") return RecordValuePages;
  return maestroComponentRegistry[node.localName.toLowerCase()] ?? null;
}

function renderElement(node: Node): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const props: Record<string, unknown> = {};
  for (const attribute of Array.from(element.attributes)) {
    const converted = safeProperty(attribute.name, attribute.value);
    if (converted) props[converted[0]] = converted[1];
  }
  const children = Array.from(element.childNodes).map(renderElement);
  const Component = componentFor(element);
  if (Component) return createElement(Component, props, ...children);
  // Ordinary HTML descendants remain HTML inside the component's React tree.
  const tag = element.localName.toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(tag) || ["script", "iframe", "object", "embed", "form", "style", "link"].includes(tag)) return null;
  return createElement(tag, props, ...children);
}

/**
 * Create portals for the top-level registered components found in sanitized
 * XSLT HTML. Descendant shadcn components are recreated in the SAME React
 * tree, retaining providers/contexts (Map/MapMarker, Dialog, Tabs, etc.).
 */
export function getMaestroComponentPortals(root: Element): ReactPortal[] {
  const hosts = Array.from(root.querySelectorAll("*"))
    .filter((element) => {
      if (!componentFor(element)) return false;
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== root) {
        if (componentFor(ancestor)) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  return hosts.map((host, index) => {
    // XSLT component names are parsed as unknown HTML elements (e.g. <map>).
    // Unknown elements are inline by default: an h-full Map inside that zero-height
    // portal host cannot lay out its canvas, leaving a gray map and misplaced marker.
    // Establish a real containing box before React mounts the map.
    if (host.localName.toLowerCase() === "map") {
      host.setAttribute("data-maestro-map-host", "true");
      const style = (host as HTMLElement).style;
      style.display = "block";
      style.width = "100%";
      style.height = "100%";
      style.minHeight = "0";
      style.position = "relative";
      // MapLibre v6 in Next.js/Turbopack requires the ESM worker to be resolved
      // through the bundler before creating any Map instance.
      maplibregl.setWorkerUrl("/maplibre-worker/maplibre-gl-worker.mjs");
    }
    const component = componentFor(host);
    if (!component) throw new Error("Missing registered component");
    const props: Record<string, unknown> = {};
    for (const attribute of Array.from(host.attributes)) {
      const converted = safeProperty(attribute.name, attribute.value);
      if (converted) props[converted[0]] = converted[1];
    }
    // The sanitized XSLT elements are only a blueprint for the component tree.
    // React recreates the entire subtree inside this portal. Leaving the source
    // DOM nodes in place renders them *as well* (notably a second map marker and
    // a stray MapControls element above the canvas).
    let children = portalChildBlueprints.get(host);
    if (!children) {
      children = Array.from(host.childNodes).map(renderElement);
      portalChildBlueprints.set(host, children);
      // Remove original XSLT nodes only once. On effect replay this container
      // can already contain LIVE React portal nodes: clearing those a second
      // time would detach visible values without a React reconciliation.
      host.replaceChildren();
    }
    return createPortal(createElement(component, props, ...children), host, host.id || `xslt-component-${index}`);
  });
}
