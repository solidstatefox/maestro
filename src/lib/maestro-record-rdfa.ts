/** Preserve exact RDF identity on values emitted by a graph-owned Record formatter.
 * XSLT may project a field as a plain label: enrich only when the currently
 * selected Record contains a unique, exact source term for that predicate.
 * No predicate or datatype is invented from a display string alone. */
export function annotateMaestroRecordRdfa(
  formatted: Document, described: XMLDocument, recordUri: string,
): Document {
  const NS = "http://openlinksw.com/services/facets/1.0/";
  type Term = { predicate: string; value: string; type: string; datatype: string; lang: string };
  const sources: Term[] = [];
  for (const row of Array.from(described.getElementsByTagNameNS(NS, "row"))) {
    const cells = row.getElementsByTagNameNS(NS, "column");
    if (cells.length < 3 || cells[0].textContent?.trim() !== recordUri) continue;
    const predicate = cells[1].textContent?.trim() ?? "";
    const value = cells[2].textContent ?? "";
    if (!/^\w[\w+.-]*:[^\s<>"{}|^`\\]+$/.test(predicate)) continue;
    sources.push({ predicate, value,
      type: cells[2].getAttribute("termType") ?? (value.startsWith("http") ? "uri" : "literal"),
      datatype: cells[2].getAttribute("datatype") ?? "",
      lang: cells[2].getAttribute("xml:lang") ?? cells[2].getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang") ?? "" });
  }
  if (!sources.length) return formatted;
  const byPredicate = new Map<string, Term[]>();
  for (const term of sources) byPredicate.set(term.predicate, [...(byPredicate.get(term.predicate) ?? []), term]);
  const byUniqueLabel = new Map<string, string>();
  const ambiguousLabels = new Set<string>();
  for (const term of sources) {
    const label = decodeURIComponentSafe(term.predicate.split(/[/#]/).pop() ?? "").replace(/_/g, " ").toLowerCase();
    if (byUniqueLabel.has(label) && byUniqueLabel.get(label) !== term.predicate) ambiguousLabels.add(label);
    else byUniqueLabel.set(label, term.predicate);
  }
  const uniqueTerm = (predicate: string, text: string, iri?: string): Term | undefined => {
    const rows = (byPredicate.get(predicate) ?? []).filter(row => iri ? row.type === "uri" && row.value === iri
      : row.type !== "uri" && row.value.trim() === text.trim());
    const distinct = new Map(rows.map(row => [`${row.type}\0${row.value}\0${row.datatype}\0${row.lang}`,row]));
    return distinct.size === 1 ? [...distinct.values()][0] : undefined;
  };
  for (const dd of Array.from(formatted.querySelectorAll("#maestro-record-viewer dd"))) {
    const preceding = dd.previousElementSibling;
    const dt = preceding?.tagName === "DT" ? preceding : dd.parentElement?.querySelector(":scope > dt");
    let predicate = dd.getAttribute("data-maestro-predicate") || dt?.getAttribute("data-maestro-predicate") || dt?.getAttribute("about") || "";
    if (!predicate && dt) {
      const name = dt.textContent?.trim().toLowerCase() ?? "";
      if (!ambiguousLabels.has(name)) predicate = byUniqueLabel.get(name) ?? "";
    }
    if (!byPredicate.has(predicate)) continue;
    if (dt && !dt.hasAttribute("data-maestro-predicate")) dt.setAttribute("data-maestro-predicate",predicate);
    if (dt && !dt.hasAttribute("about")) dt.setAttribute("about", predicate);
    if (!dd.hasAttribute("data-maestro-predicate")) dd.setAttribute("data-maestro-predicate",predicate);
    const atoms = Array.from(dd.querySelectorAll("span, a, time"));
    for (const node of atoms) {
      if (node.querySelector("span, a, time")) continue;
      const uri = node.getAttribute("data-maestro-record-uri") || node.getAttribute("resource") || "";
      const term = uniqueTerm(predicate, node.getAttribute("content") ?? node.textContent ?? "", uri || undefined);
      if (!term) continue;
      if (term.type === "uri") {
        if (!node.hasAttribute("resource")) node.setAttribute("resource", term.value);
        if (!node.hasAttribute("rel")) node.setAttribute("rel", predicate);
        if (!node.hasAttribute("data-maestro-record-uri")) node.setAttribute("data-maestro-record-uri",term.value);
      } else {
        if (!node.hasAttribute("property")) node.setAttribute("property",predicate);
        if (!node.hasAttribute("content")) node.setAttribute("content",term.value);
        if (term.datatype && !node.hasAttribute("datatype")) node.setAttribute("datatype",term.datatype);
        if (term.lang && !node.hasAttribute("lang")) node.setAttribute("lang",term.lang);
      }
    }
  }
  // Titles can be literal RDF labels. Annotate only an exact, uniquely
  // identified label, never a generated fallback (e.g. an IRI local name).
  const title = formatted.querySelector("#maestro-record-viewer #record-title");
  if (title && !title.hasAttribute("property")) {
    const names = sources.filter(row => /[/#](?:label|name|title)$/.test(row.predicate) &&
      row.type !== "uri" && row.value.trim() === title.textContent?.trim());
    if (names.length === 1) {
      title.setAttribute("property", names[0].predicate);
      title.setAttribute("content", names[0].value);
      if (names[0].lang) title.setAttribute("lang", names[0].lang);
    }
  }
  return formatted;
}
function decodeURIComponentSafe(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
