/** Client-side selection IDs only; actual providers and stylesheets remain SHACL-discovered. */
export const PERSONAL_PERSPECTIVE_URI = {
  bookmarks: "gttp://ggg.maestro.ecosys/shacl/provider/bookmarks-perspective",
  history: "gttp://ggg.maestro.ecosys/shacl/provider/history-perspective",
} as const;
export type PersonalPerspectiveKind = keyof typeof PERSONAL_PERSPECTIVE_URI;
export function personalPerspectiveFromUri(uri: string): PersonalPerspectiveKind | null {
  if (uri === PERSONAL_PERSPECTIVE_URI.bookmarks) return "bookmarks";
  if (uri === PERSONAL_PERSPECTIVE_URI.history) return "history";
  return null;
}


/** A personal collection is a Perspective only inside its own FCT population.
 * SHACL discovery/approval remains authoritative; this is the presentation
 * scope gate preventing a Bookmarks ribbon on an unrelated search or catalog. */
export function personalPerspectiveMatchesQuery(uri: string, tree: {
  attributes: Record<string,string>;
  children: Array<{name:string;attributes:Record<string,string>;children?:unknown[]}>;
}): boolean {
  const kind = personalPerspectiveFromUri(uri);
  if (!kind) return true;
  // The FCT root addr is authoritative when a separate graph attribute is
  // absent (including restored query/share URLs).
  const addressGraph = (tree.attributes.addr || "").split("@")[0];
  const namedGraph = (tree.attributes.graph || addressGraph).trim();
  const expectedGraph = kind === "bookmarks" ? "#bookmarks" : "#history";
  if (!namedGraph.endsWith(expectedGraph)) return false;
  const expectedClass = kind === "bookmarks"
    ? "http://www.w3.org/2002/01/bookmark#Bookmark"
    : "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#QueryHistoryVisit";
  const containsClass = (nodes: Array<{name:string;attributes:Record<string,string>;children?:unknown[]}>): boolean =>
    nodes.some(node => (node.name === "class" && node.attributes.iri === expectedClass) ||
      (Array.isArray(node.children) && containsClass(node.children as typeof nodes)));
  return containsClass(tree.children);
}
