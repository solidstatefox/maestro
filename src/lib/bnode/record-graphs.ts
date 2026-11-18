/** Blank-node graph discovery is only available from an observed blank-node
 * Record. The generic Record graph marshaller delegates here; no URI path
 * imports the blank-node FCT reconstruction implementation. */
import type { RecordGraphDiscoveryLimits } from "@/lib/record-graph-limits";
import { snapshotFctQueryXml } from "@/lib/fct-query-clone";

export function blankNodeGraphFctQuery(blankQueryXml: string, limits: RecordGraphDiscoveryLimits): string {

  const doc = new DOMParser().parseFromString(snapshotFctQueryXml(blankQueryXml, "data"), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid blank-node FCT selection.");
  const views = Array.from(doc.getElementsByTagName("*")).filter(node => node.localName === "view");
  if (views.length !== 1) throw new Error("Expected one FCT view.");
  const view = views[0];
  doc.documentElement.removeAttribute("src"); // Projection is not a Providers navigation.
  const rootFocus = view.parentElement === doc.documentElement;
  // For a root blank-node Record, the Results page itself is the identity.
  // Preserve that page's offset and do not expand its candidate set to the
  // full Sheet ceiling. Nested URI-anchored paths start at offset zero.
  const pageSize = Number(view.getAttribute("limit") ?? limits.candidates);
  const pageOffset = Number(view.getAttribute("offset") ?? 0);
  if (rootFocus && (!Number.isSafeInteger(pageSize) || pageSize < 1 ||
            !Number.isSafeInteger(pageOffset) || pageOffset < 0))
    throw new Error("Invalid root blank-node Results page.");
  view.setAttribute("bnode", "yes");
  view.setAttribute("type", "graphs");
  view.setAttribute("record", "yes");
  view.setAttribute("candidates", String(Math.min(limits.candidates, pageSize)));
  view.setAttribute("candidateOffset", String(pageOffset));
  view.setAttribute("limit", String(limits.graphs));
  view.setAttribute("offset", "0");
  return new XMLSerializer().serializeToString(doc);
}
