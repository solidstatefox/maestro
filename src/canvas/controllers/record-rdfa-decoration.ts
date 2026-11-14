/**
 * Shared Record RDFa source decoration. Formatters emit RDFa; the Record
 * controller owns selection and paints it. No XSLT receives a session index.
 *
 * The selected *statement*, not its predicate alone, identifies the followed
 * value. A predicate can have several values in one Record.
 */
export type RecordStatement = {
  predicate: string;
  direction: "property" | "property-of";
  value: string;
  termType: "uri" | "literal" | "bnode";
  datatype?: string;
  lang?: string;
};

function predicateOn(node: Element): string | null {
  return node.getAttribute("data-maestro-predicate") ||
    node.getAttribute("data-predicate") ||
    node.getAttribute("rev") || node.getAttribute("rel") ||
    node.getAttribute("property");
}

function directionOn(node: Element): "property" | "property-of" {
  return node.getAttribute("data-maestro-direction") === "property-of" || node.hasAttribute("rev")
    ? "property-of" : "property";
}

/** Recognize an RDFa value, independent of its displayed label. */
export function recordBindingOn(node: Element): RecordStatement | null {
  const carrier = node.closest("[data-maestro-predicate],[data-predicate],[rel],[rev],[property]");
  const predicate = carrier && predicateOn(carrier);
  if (!carrier || !predicate) return null;
  // Ignore HTML rel tokens such as "noopener noreferrer". A navigable RDFa
  // predicate must be an IRI or CURIE, never a generic browser link relation.
  if (!/^[a-z][a-z0-9+.-]*:\S+$/i.test(predicate)) return null;
  const direction = directionOn(carrier);
  const uri = node.getAttribute("resource") || node.getAttribute("data-maestro-record-uri") ||
    node.getAttribute("data-maestro-iri") || carrier.getAttribute("resource") ||
    carrier.getAttribute("data-maestro-record-uri") || carrier.getAttribute("data-maestro-iri");
  if (uri && uri !== "#") {
    return { predicate, direction, value: uri, termType: uri.startsWith("_:") ? "bnode" : "uri" };
  }
  if (carrier.hasAttribute("content") || carrier.hasAttribute("data-maestro-literal") ||
      carrier.hasAttribute("property")) {
    // RDFa permits lexical literals as element text when @content is absent.
    // Compare exactly against the RDF term so display-only abbreviations won't
    // be incorrectly painted as a different source value.
    const value = carrier.getAttribute("content") ?? carrier.getAttribute("data-maestro-literal") ??
      (carrier.textContent ?? "").trim();
    return { predicate, direction, value, termType: "literal",
      ...(carrier.getAttribute("datatype") ? { datatype: carrier.getAttribute("datatype")! } : {}),
      ...(carrier.getAttribute("lang") || carrier.getAttribute("xml:lang") ? { lang: (carrier.getAttribute("lang") || carrier.getAttribute("xml:lang"))! } : {}) };
  }
  return null;
}

export function sameRecordStatement(a: RecordStatement, b: RecordStatement): boolean {
  return a.predicate === b.predicate && a.direction === b.direction &&
    a.value === b.value && a.termType === b.termType &&
    (a.datatype || "") === (b.datatype || "") &&
    (a.lang || "").toLowerCase() === (b.lang || "").toLowerCase();
}

/**
 * Paint only the matching statement and its corresponding property label.
 * Safe to call repeatedly after formatter rerenders, pagination, or breadcrumbs.
 * Never mutates the RDFa semantics themselves.
 */
export function decorateFollowedRecordSource(host: Element, source: RecordStatement | null): void {
  host.querySelectorAll("[data-maestro-followed-source],[data-maestro-followed-predicate]").forEach(node => {
    node.removeAttribute("data-maestro-followed-source");
    node.removeAttribute("data-maestro-followed-predicate");
  });
  if (!source) return;

  const values = host.querySelectorAll(
    "[data-maestro-property-value],[resource],[data-maestro-record-uri],[data-maestro-iri],[content],[data-maestro-literal]"
  );
  for (const element of Array.from(values)) {
    const binding = recordBindingOn(element);
    if (!binding || !sameRecordStatement(binding, source)) continue;
    // Prefer the exact RDFa value, not an enclosing table row containing
    // multiple values. In the default renderer the value wrapper is the target.
    const selected = element.closest("[data-maestro-property-value]") ?? element;
    selected.setAttribute("data-maestro-followed-source", "true");

    // Find the property label within the same statement/field container.
    const statement = selected.closest("tr, [data-maestro-statement], [data-maestro-property-row], dl > div, div[id^='field-']") ?? selected.parentElement;
    if (!statement) continue;
    const labels = statement.querySelectorAll("[data-maestro-predicate], [data-predicate], dt, th");
    for (const label of Array.from(labels)) {
      if (label === selected || selected.contains(label)) continue;
      const declaredPredicate = predicateOn(label);
      if ((declaredPredicate === source.predicate || (!declaredPredicate && label.matches("dt, th"))) &&
          (!declaredPredicate || directionOn(label) === source.direction) &&
          (label.hasAttribute("about") || label.matches("dt, button, th"))) {
        label.setAttribute("data-maestro-followed-predicate", "true");
      }
    }
  }
}

/** A formatter-independent interaction binding. When a legacy provider emits
 * a URI without a predicate annotation, only a unique term in the authoritative
 * Record SELECT can resolve it. Ambiguous values are never guessed. */
export function resolveRecordInteraction(node: Element, rows: readonly RecordStatement[], wand: boolean): RecordStatement | null {
  const annotated = recordBindingOn(node);
  if (annotated) return annotated;
  const uriNode = node.closest("[data-maestro-record-uri],[data-maestro-iri],[resource],[href]");
  const uri = uriNode?.getAttribute("data-maestro-record-uri") ||
    uriNode?.getAttribute("data-maestro-iri") || uriNode?.getAttribute("resource") ||
    uriNode?.getAttribute("href") || "";
  const matches = uri && /^[a-z][a-z0-9+.-]*:\S+$/i.test(uri)
    ? rows.filter(row => row.value === uri && row.termType === "uri") : [];
  if (matches.length === 1) return matches[0];
  if (wand) {
    const labelled = node.closest("[data-maestro-predicate],[data-predicate],[rel],[rev],[property]");
    const predicate = labelled ? predicateOn(labelled) : null;
    if (predicate && /^[a-z][a-z0-9+.-]*:\S+$/i.test(predicate)) {
      return { predicate, direction: directionOn(labelled!), termType: "uri", value: "" };
    }
    const label = (node.textContent ?? "").trim();
    const labelMatches = rows.filter(row => row.predicate === label || row.predicate.split(/[\/#]/).pop() === label);
    const unique = new Map(labelMatches.map(row => [`${row.direction}\u0000${row.predicate}`, row]));
    if (unique.size === 1) {
      const source = [...unique.values()][0];
      return { ...source, value: "", termType: "uri", datatype: undefined, lang: undefined };
    }
  }
  return null;
}

/** The Wand queue is query intent, not formatter state. Decorate every
 * matching property/role consistently, including user-authored XSLT RDFa.
 * Decorations are removable and never modify the RDFa attributes. */
export function decorateWandedRecordProperties(
  host: Element,
  selected: readonly { predicate: string; direction: "property" | "property-of" }[],
): void {
  host.querySelectorAll("[data-maestro-wanded]").forEach(node => node.removeAttribute("data-maestro-wanded"));
  if (!selected.length) return;
  const keys = new Set(selected.map(item => `${item.direction}\u0000${item.predicate}`));
  const candidates = host.querySelectorAll(
    "[data-maestro-property-value],button[data-maestro-predicate],[rel][resource],[rev][resource],[property][content]",
  );
  for (const element of Array.from(candidates)) {
    const predicate = predicateOn(element);
    if (predicate && keys.has(`${directionOn(element)}\u0000${predicate}`)) {
      element.setAttribute("data-maestro-wanded", "true");
    }
  }
}
