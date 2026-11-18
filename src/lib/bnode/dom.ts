/** Browser-side XML query construction for blank-node Records.
 * Preserve the actual Results path, URI parent binding, and graph address;
 * blank-node result labels must never become RDF IRIs or standalone queries.
 * This module may be imported only where DOMParser/XMLSerializer are available.
 */
import { FCT_VIEW_TYPES } from "@/lib/fct-view-types";
import { snapshotFctQueryXml } from "@/lib/fct-query-clone";
import { isStructuralReverseRole } from "@/lib/bnode";

/** Add an already-supported URI equality constraint without fabricating an
 * FCT resource-set OR or duplicating a value already bound at that scope. */
function addUriAnchor(doc: Document, scope: Element, uri: string): void {
  const values = Array.from(scope.children).filter(node => node.localName === "value");
  if (values.length) {
    if (values.length === 1 && values[0].getAttribute("datatype") === "uri" &&
        (!values[0].getAttribute("op") || values[0].getAttribute("op") === "=") &&
        values[0].textContent === uri) return;
    throw new Error("The chosen URI anchor conflicts with existing FCT value bindings.");
  }
  const value = doc.createElementNS("http://openlinksw.com/services/facets/1.0", "value");
  value.setAttribute("datatype", "uri");
  value.textContent = uri;
  scope.appendChild(value);
}

/**
 * Derive a blank-node Record query from the actual Results FCT path.
 *
 * A reverse-role badge can be a sibling of <view> (the usual Results shape)
 * or the view-bearing relationship itself. In either case bind the badge URI
 * on that exact <property-of> node and leave the complete FCT constraints
 * intact. The view must focus on the blank node, not on the URI badge.
 *
 * Blank nodes opened from an unrelated URI Record table do not have a matching
 * Results path: only that explicit navigation may use a standalone URI anchor.
 */
export function blankNodeRecordListValuesQuery(
  sourceXml: string, predicate: string, parentUri: string, limit: number,
  allowDirectAnchorFallback = false,
  parentDirection?: "forward" | "reverse",
  anchorDepth?: number,
): string {
  const doc = new DOMParser().parseFromString(snapshotFctQueryXml(sourceXml, "data"), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid Results FCT XML.");
  const ns = "http://openlinksw.com/services/facets/1.0";
  const view = Array.from(doc.getElementsByTagNameNS(ns, "view"))[0];
  if (!view || !view.parentElement) throw new Error("Results query has no view carrier.");
  const carrier = view.parentElement;
  const hasRolePredicate = (node: Element) =>
    isStructuralReverseRole(node, predicate);

  // Most commonly the role is an immediate sibling of <view> inside the
  // property that binds the blank node. Do not move <view> in this case.
  const siblingRole = Array.from(carrier.children).find(hasRolePredicate);
  // Alternatively, <view> may be carried by the reverse relationship itself;
  // its immediate parent binds the blank node when it is a forward property.
  const carrierRole = hasRolePredicate(carrier) && carrier.parentElement?.localName === "property"
    ? carrier : null;
  const selectedRole = siblingRole ?? carrierRole;

  // The parent may itself be a blank node. FCT identity then uses the nearest
  // URI ancestor on the SAME structural property path (depth 0 is the root).
  // Constrain that ancestor in-place and preserve every intermediate predicate.
  const path: Element[] = [];
  for (let element: Element | null = carrier; element && element !== doc.documentElement; element = element.parentElement) {
    if (element.localName === "property" || element.localName === "property-of") path.unshift(element);
  }
  if (!allowDirectAnchorFallback && anchorDepth !== undefined) {
    if (!Number.isSafeInteger(anchorDepth) || anchorDepth < 0 || anchorDepth >= path.length) {
      throw new Error("The blank-node URI anchor does not belong to the active FCT property path.");
    }
    const scope = anchorDepth === 0 ? doc.documentElement : path[anchorDepth - 1];
    addUriAnchor(doc, scope, parentUri);
  } else if (!allowDirectAnchorFallback &&
      ((parentDirection === "forward" && carrier.localName === "property") ||
       (parentDirection === "reverse" && carrier.localName === "property-of")) &&
      carrier.getAttribute("iri") === predicate &&
      carrier.parentElement) {
    // The view-bearing relationship itself binds the blank node. Its outer
    // focus is the URI parent projected by the SAME Results SELECT. Bind that
    // parent in its existing FCT scope; keep the full path and the view in place.
    addUriAnchor(doc, carrier.parentElement, parentUri);
  } else if (selectedRole && !allowDirectAnchorFallback && parentDirection !== "forward") {
    addUriAnchor(doc, selectedRole, parentUri);
    if (selectedRole === carrierRole) {
      // The selected role binds the parent URI; focus the outgoing property
      // that binds the blank node, retaining the rest of the original path.
      carrier.parentElement!.appendChild(view);
    }
  } else if (allowDirectAnchorFallback) {
    // A blank node clicked in a URI Record table is not necessarily in the
    // active Results path. Build a separate URI-anchored path only for it.
    const root = doc.documentElement;
    while (root.firstChild) root.removeChild(root.firstChild);
    const value = doc.createElementNS(ns, "value");
    value.setAttribute("datatype", "uri");
    value.textContent = parentUri;
    root.appendChild(value);
    const property = doc.createElementNS(ns, parentDirection === "reverse" ? "property-of" : "property");
    property.setAttribute("iri", predicate);
    root.appendChild(property);
    property.appendChild(view);
  } else {
    throw new Error("The selected reverse-property badge is not present at the active Results view scope.");
  }

  view.setAttribute("type", FCT_VIEW_TYPES.LIST_VALUES);
  view.setAttribute("limit", String(limit));
  view.setAttribute("offset", "0");
  view.removeAttribute("sort");
  view.removeAttribute("badges");
  doc.documentElement.setAttribute("order", "no");
  return new XMLSerializer().serializeToString(doc);
}

/** Reuse the existing FCT path to retrieve response-local candidate blank nodes.
 * There is no cross-request identity without a URI anchor; always require
 * explicit candidate selection, even if a page currently contains one. */
export function unanchoredBlankNodeRecordQuery(sourceXml: string, limit: number): string {
  const doc = new DOMParser().parseFromString(snapshotFctQueryXml(sourceXml, "data"), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid Results FCT XML.");
  const view = Array.from(doc.getElementsByTagName("*")).find(node => node.localName === "view");
  if (!view) throw new Error("The Results query has no view carrier.");
  // Preserve the page that actually contained the selected RDF term.
  // Widening it or resetting its offset would silently change candidates.
  const pageLimit = Number(view.getAttribute("limit"));
  const boundedLimit = Number.isSafeInteger(pageLimit) && pageLimit > 0
    ? Math.min(limit, pageLimit) : limit;
  view.setAttribute("type", FCT_VIEW_TYPES.LIST_VALUES);
  view.setAttribute("limit", String(boundedLimit));
  view.removeAttribute("badges");
  view.removeAttribute("sort");
  doc.documentElement.setAttribute("order", "no");
  return new XMLSerializer().serializeToString(doc);
}

/** Rebind root-level blank nodes through the current Results page, not a URI parent. */
export function rootBlankNodeRecordQuery(sourceXml: string): string {
  const doc = new DOMParser().parseFromString(snapshotFctQueryXml(sourceXml, "data"), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid Results FCT XML.");
  const ns = "http://openlinksw.com/services/facets/1.0";
  const view = Array.from(doc.getElementsByTagNameNS(ns, "view"))[0];
  if (!view || view.parentElement !== doc.documentElement) {
    throw new Error("Root blank-node Records require a root-level Results view.");
  }
  // Keep the search, class/property filters, index letter, page and ordering.
  // Each blank node is rebound and described inside one SPARQL response.
  view.setAttribute("type", FCT_VIEW_TYPES.LIST_VALUES);
  view.removeAttribute("badges");
  return new XMLSerializer().serializeToString(doc);
}

/**
 * Extend an already URI-anchored, FCT-derived blank-node Record to a nested
 * blank-node RDFa value. This stays within the original URI anchor and all
 * intervening property/role steps; no response-local _: label is queried.
 */
export function extendBlankNodeRecordQuery(sourceXml: string, predicate: string,
  direction: "forward" | "reverse", limit: number): string {
  const document = new DOMParser().parseFromString(snapshotFctQueryXml(sourceXml, "data"), "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Invalid anchored blank-node Record FCT query.");
  const ns = "http://openlinksw.com/services/facets/1.0";
  const view = Array.from(document.getElementsByTagNameNS(ns, "view"))[0];
  if (!view || !view.parentElement) throw new Error("Blank-node query has no active view.");
  const next = document.createElementNS(ns, direction === "reverse" ? "property-of" : "property");
  next.setAttribute("iri", predicate);
  view.parentElement.appendChild(next);
  next.appendChild(view);
  view.setAttribute("type", FCT_VIEW_TYPES.LIST_VALUES);
  view.setAttribute("limit", String(limit));
  view.setAttribute("offset", "0");
  view.removeAttribute("sort");
  view.removeAttribute("badges");
  return new XMLSerializer().serializeToString(document);
}
