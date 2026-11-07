/** Render a SHACL-discovered XSLT View over the currently visible FCT result page. */
export type ViewResult = {
  uri: string; label: string; selected?: boolean;
  endpoint?: string; endpointId?: string; favicon?: string; rank?: string;
  target?: string; detail?: string; health?: string; healthState?: string; pinging?: boolean; group?: string; product?: string; version?: string; description?: string;
};

export function renderDiscoveredViewXslt(stylesheetText: string, rows: ViewResult[], options?: {
  availableRows?: ViewResult[]; page?: number; pageSize?: number;
}): string {
  if (typeof DOMParser === "undefined" || typeof XSLTProcessor === "undefined") {
    throw new Error("This browser does not support XSLT views.");
  }
  if (stylesheetText.length > 250000 || /<\s*xsl:(?:import|include)\b|\bdocument\s*\(|\b(?:javascript|data):/i.test(stylesheetText)) {
    throw new Error("View stylesheet contains unsupported external references.");
  }
  const doc = document.implementation.createDocument(null, "results");
  const makeResult = (row: ViewResult) => {
    const element = doc.createElement("result");
    element.setAttribute("uri", row.uri);
    element.setAttribute("label", row.label);
    if (row.selected) element.setAttribute("selected", "true");
    if (row.pinging) element.setAttribute("pinging", "true");
    for (const key of ["endpoint", "endpointId", "favicon", "rank", "health", "healthState", "group", "product", "version", "description", "target", "detail"] as const) {
      if (row[key]) element.setAttribute(key, row[key]);
    }
    return element;
  };
  rows.forEach((row) => doc.documentElement.appendChild(makeResult(row)));
  if (options?.availableRows) {
    doc.documentElement.setAttribute("page", String(options.page ?? 0));
    doc.documentElement.setAttribute("pageSize", String(options.pageSize ?? rows.length));
    const available = doc.createElement("available");
    options.availableRows.forEach((row) => available.appendChild(makeResult(row)));
    doc.documentElement.appendChild(available);
  }
  const xslt = new DOMParser().parseFromString(stylesheetText, "application/xml");
  if (xslt.querySelector("parsererror") || !["stylesheet", "transform"].includes(xslt.documentElement.localName) || xslt.documentElement.namespaceURI !== "http://www.w3.org/1999/XSL/Transform") {
    throw new Error("Discovered View stylesheet is not valid XSLT XML.");
  }
  const processor = new XSLTProcessor();
  processor.importStylesheet(xslt);
  const transformed = processor.transformToFragment(doc, document);
  if (!transformed) throw new Error("View XSLT produced no output.");
  const allowedTags = new Set(["div", "section", "article", "header", "footer", "h1", "h2", "h3", "h4", "p", "span", "strong", "em", "small", "ul", "ol", "li", "a", "button", "code", "pre", "img"]);
  const supportedIcons = new Set(["server", "network", "globe", "database", "layout-grid", "badge-check", "badge-alert", "badge-x", "badge-question-mark", "refresh-cw"]);
  const svgNs = "http://www.w3.org/2000/svg";
  // Render safe, allowlisted Lucide symbols from XSLT placeholders. Never accept arbitrary SVG from a stylesheet.
  const insertLucideIcon = (node: Element, name: string) => {
    const svg = document.createElementNS(svgNs, "svg");
    for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "size-5" })) svg.setAttribute(key, value);
    svg.setAttribute("aria-hidden", "true");
    const parts: Record<string, Array<[string, Record<string,string>]>> = {
      server: [["rect", { x:"2",y:"2",width:"20",height:"8",rx:"2" }],["rect", { x:"2",y:"14",width:"20",height:"8",rx:"2" }],["line", { x1:"6",y1:"6",x2:"6.01",y2:"6" }],["line", { x1:"6",y1:"18",x2:"6.01",y2:"18" }]],
      network: [["rect",{x:"16",y:"16",width:"6",height:"6",rx:"1"}],["rect",{x:"2",y:"16",width:"6",height:"6",rx:"1"}],["rect",{x:"9",y:"2",width:"6",height:"6",rx:"1"}],["path",{d:"M12 8v4m0 0H5v4m7-4h7v4"}]],
      globe: [["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"}]],
      database: [["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3"}],["path",{d:"M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0"}]],
      "badge-check": [["path",{d:"M3.85 8.62a4 4 0 0 1 4.77-4.77 4 4 0 0 1 6.76 0 4 4 0 0 1 4.77 4.77 4 4 0 0 1 0 6.76 4 4 0 0 1-4.77 4.77 4 4 0 0 1-6.76 0 4 4 0 0 1-4.77-4.77 4 4 0 0 1 0-6.76"}],["path",{d:"m8 12 3 3 5-6"}]],
      "badge-alert": [["path",{d:"M3.85 8.62a4 4 0 0 1 4.77-4.77 4 4 0 0 1 6.76 0 4 4 0 0 1 4.77 4.77 4 4 0 0 1 0 6.76 4 4 0 0 1-4.77 4.77 4 4 0 0 1-6.76 0 4 4 0 0 1-4.77-4.77 4 4 0 0 1 0-6.76"}],["path",{d:"M12 7v6m0 4h.01"}]],
      "badge-x": [["path",{d:"M3.85 8.62a4 4 0 0 1 4.77-4.77 4 4 0 0 1 6.76 0 4 4 0 0 1 4.77 4.77 4 4 0 0 1 0 6.76 4 4 0 0 1-4.77 4.77 4 4 0 0 1-6.76 0 4 4 0 0 1-4.77-4.77 4 4 0 0 1 0-6.76"}],["path",{d:"m9 9 6 6m0-6-6 6"}]],
      "badge-question-mark": [["path",{d:"M3.85 8.62a4 4 0 0 1 4.77-4.77 4 4 0 0 1 6.76 0 4 4 0 0 1 4.77 4.77 4 4 0 0 1 0 6.76 4 4 0 0 1-4.77 4.77 4 4 0 0 1-6.76 0 4 4 0 0 1-4.77-4.77 4 4 0 0 1 0-6.76"}],["path",{d:"M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4m.1 3h.01"}]],
      "refresh-cw": [["path",{d:"M3 12a9 9 0 0 1 15.36-6.36L21 8"}],["path",{d:"M21 3v5h-5"}],["path",{d:"M21 12a9 9 0 0 1-15.36 6.36L3 16"}],["path",{d:"M8 16H3v5"}]],
      "layout-grid": [["rect",{x:"3",y:"3",width:"7",height:"7",rx:"1"}],["rect",{x:"14",y:"3",width:"7",height:"7",rx:"1"}],["rect",{x:"3",y:"14",width:"7",height:"7",rx:"1"}],["rect",{x:"14",y:"14",width:"7",height:"7",rx:"1"}]],
    };
    for (const [tag, attrs] of parts[name] ?? []) {
      const part = document.createElementNS(svgNs, tag);
      for (const [key, value] of Object.entries(attrs)) part.setAttribute(key, value);
      svg.appendChild(part);
    }
    node.replaceChildren(svg);
  };
  const sanitize = (root: Node): void => {
    for (const child of Array.from(root.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        if (!allowedTags.has(element.localName.toLowerCase())) { element.remove(); continue; }
        for (const attribute of Array.from(element.attributes)) {
          const name = attribute.name.toLowerCase();
          if (name === "href" && element.localName.toLowerCase() === "a") {
            try { const url = new URL(attribute.value); if (!["http:", "https:"].includes(url.protocol)) element.removeAttribute(attribute.name); }
            catch { element.removeAttribute(attribute.name); }
          } else if (name === "src" && element.localName.toLowerCase() === "img") {
            try { const url = new URL(attribute.value); if (url.protocol !== "https:") element.removeAttribute(attribute.name); }
            catch { element.removeAttribute(attribute.name); }
          } else if (name === "data-favicon-fallback" && element.localName.toLowerCase() === "img") {
            try { const url = new URL(attribute.value); if (url.protocol !== "https:") element.removeAttribute(attribute.name); }
            catch { element.removeAttribute(attribute.name); }
          } else if (name === "data-endpoint-select" && element.localName.toLowerCase() === "button") {
            // The delegated View handler validates the registry ID before selection.
          } else if (name === "data-endpoint-refresh" && element.localName.toLowerCase() === "button") {
            // React checks this key against the active configured registry.
          } else if (name === "type" && attribute.value === "button" && element.localName.toLowerCase() === "button") {
            // Avoid form submission.
          } else if (name === "target" && attribute.value === "_blank" && element.localName.toLowerCase() === "a") {
            // External link target.
          } else if (name === "data-lucide-icon" && element.localName.toLowerCase() === "span" && supportedIcons.has(attribute.value)) {
            // Handled after attributes are sanitized.
          } else if (name === "data-slot" && attribute.value === "separator" && element.localName.toLowerCase() === "div") {
            // shadcn/ui Separator presentation metadata.
          } else if (name === "role" && attribute.value === "none" && element.localName.toLowerCase() === "div") {
            // Decorative separator.
          } else if (["data-view-title", "data-view-icon"].includes(name) && element.localName.toLowerCase() === "section") {
            // View metadata can be declared by the XSLT root element.
          } else if (name === "alt" && element.localName.toLowerCase() === "img") {
            // Safe plain-text alternative.
          } else if (!["class", "title", "aria-label"].includes(name)) element.removeAttribute(attribute.name);
        }
        if (element.localName.toLowerCase() === "a") {
          element.setAttribute("rel", "noopener noreferrer");
          element.setAttribute("target", "_blank");
        }
        sanitize(element);
        if (element.localName.toLowerCase() === "span" && supportedIcons.has(element.getAttribute("data-lucide-icon") ?? "")) {
          insertLucideIcon(element, element.getAttribute("data-lucide-icon")!);
          element.removeAttribute("data-lucide-icon");
        }
      } else if (child.nodeType !== Node.TEXT_NODE) root.removeChild(child);
    }
  };
  sanitize(transformed);
  const container = document.createElement("div");
  container.appendChild(transformed);
  return container.innerHTML;
}
