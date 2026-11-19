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

export type FullscreenRecordTarget = {
  kind: "property" | "value";
  statement: RecordStatement;
};

/** A <dt> is a property label, not a value. An RDFa resource/content is a
 * value even when its parent <tr>/<dd> also carries a predicate annotation.
 * Resolve unannotated formatter captions only when one predicate matches: a
 * decorative heading must never turn into an arbitrary query binding. */
export function resolveFullscreenRecordTarget(
  target: Element, rows: readonly RecordStatement[],
): FullscreenRecordTarget | null {
  const valueTarget = target.closest(
    "[data-maestro-property-value],[data-maestro-record-uri],[data-maestro-iri]," +
    "[resource],[content],[data-maestro-literal],a[rel],a[rev],a[property]",
  );
  if (valueTarget) {
    const statement = resolveRecordInteraction(valueTarget, rows, false);
    if (statement && statement.value) return { kind: "value", statement };
  }

  // A legacy XSLT may emit literal values as plain text nodes inside <dd>.
  // Permit the pivot only if the exact lexical value identifies one RDF term
  // from the authoritative Record SELECT (never infer identity from styling).
  const textCarrier = target.closest("dd span,dd p,td span,td p,[data-maestro-record-literal]");
  if (textCarrier && !valueTarget) {
    const text = (textCarrier.textContent ?? "").trim();
    const scoped = textCarrier.closest("[data-maestro-predicate],[data-predicate],tr,dl > div");
    const predicate = scoped ? predicateOn(scoped) : null;
    const direction = scoped ? directionOn(scoped) : "property";
    const matching = rows.filter(row => row.termType === "literal" && row.value === text &&
      (!predicate || (row.predicate === predicate && row.direction === direction)));
    if (matching.length === 1) return { kind: "value", statement: matching[0] };
  }

  const propertyTarget = target.closest(
    "[data-maestro-filter-property],button[data-maestro-predicate]," +
    "dt,th[data-maestro-predicate],th[about],button[about],[data-maestro-property-label]",
  );
  if (propertyTarget) {
    const predicate = predicateOn(propertyTarget) ||
      propertyTarget.getAttribute("data-maestro-filter-property") ||
      propertyTarget.getAttribute("about");
    const direction = directionOn(propertyTarget);
    if (predicate && /^[a-z][a-z0-9+.-]*:\S+$/i.test(predicate)) {
      return { kind: "property", statement: {
        predicate, direction, value: "", termType: "uri",
      } };
    }
    // Some legacy XSLT templates use <dt> with a human-readable RDFa
    // predicate label but omit @about. Only a unique vocabulary match counts.
    const caption = (propertyTarget.textContent ?? "").trim().toLowerCase();
    const candidates = new Map<string, RecordStatement>();
    for (const row of rows) {
      const local = row.predicate.split(/[\/#]/).pop()?.toLowerCase() ?? "";
      if (caption && (caption === local || caption === row.predicate.toLowerCase()))
        candidates.set(`${row.direction}\u0000${row.predicate}`, row);
    }
    if (candidates.size === 1) {
      const item = [...candidates.values()][0];
      return { kind: "property", statement: { predicate: item.predicate,
        direction: item.direction, value: "", termType: "uri" } };
    }
  }
  // Fall back to a uniquely resolved RDFa statement (e.g., a provider emits
  // data-maestro-record-uri without @rel but its Record SELECT has one match).
  const statement = resolveRecordInteraction(target, rows, false);
  if (statement?.value && target.closest("a,button,[role=button],[property],[resource],[content]"))
    return { kind: "value", statement };
  return null;
}

/** Local visual affordances are independent from Browse query handlers. */
export function decorateRecordInteractiveTargets(host: Element, rows: readonly RecordStatement[]): void {
  host.querySelectorAll("[data-maestro-record-interactive]").forEach(node =>
    node.removeAttribute("data-maestro-record-interactive"));
  const selectors = [
    "[data-maestro-property-value]", "[data-maestro-record-uri]", "[resource]",
    "[content]", "dd span", "dd p", "td span", "td p", "a[href]", "[data-maestro-record-literal]", "button[data-maestro-predicate]", "button[about]", "dt", "th[data-maestro-predicate]", "th[about]",
    "[data-maestro-filter-property]",
  ].join(",");
  for (const element of Array.from(host.querySelectorAll(selectors))) {
    const target = resolveFullscreenRecordTarget(element, rows);
    if (target) element.setAttribute("data-maestro-record-interactive", target.kind);
  }
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
  const scope = node.closest("[data-maestro-predicate],[data-predicate],tr,[data-maestro-statement]");
  const contextualPredicate = scope && predicateOn(scope);
  const contextualDirection = scope ? directionOn(scope) : "property";
  const matches = uri && /^[a-z][a-z0-9+.-]*:\S+$/i.test(uri)
    ? rows.filter(row => row.value === uri && row.termType === "uri" &&
      (!contextualPredicate || (row.predicate === contextualPredicate && row.direction === contextualDirection))) : [];
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
  selected: readonly {
    predicate: string; direction: "property" | "property-of";
    kind?: "property" | "value";
    value?: string;
    termType?: "uri" | "literal" | "bnode";
    datatype?: string; lang?: string;
  }[],
  rows: readonly RecordStatement[] = [],
): void {
  host.querySelectorAll("[data-maestro-wanded]").forEach(node => node.removeAttribute("data-maestro-wanded"));
  if (!selected.length) return;
  const candidates = host.querySelectorAll(
    "[data-maestro-property-value],button[data-maestro-predicate],dt,th[data-maestro-predicate],th[about]," +
    "[data-maestro-property-label],[data-maestro-record-uri],[resource],[content]," +
    "dd span,dd p,[data-maestro-record-literal]",
  );
  for (const element of Array.from(candidates)) {
    const found = resolveFullscreenRecordTarget(element, rows);
    if (!found) continue;
    const sameSelection = selected.some(item =>
      item.predicate === found.statement.predicate && item.direction === found.statement.direction &&
      (found.kind === "property" ||
       ((item.kind ?? "property") === "value" &&
       (item.value === found.statement.value && item.termType === found.statement.termType &&
        (item.datatype ?? "") === (found.statement.datatype ?? "") &&
        (item.lang ?? "").toLowerCase() === (found.statement.lang ?? "").toLowerCase()))));
    if (!sameSelection) continue;
    // Prefer one precise value carrier rather than outlining its ancestor row
    // and every child link. A property-only Wand never paints its RDF values.
    const atom = found.kind === "value"
      ? element.closest("[data-maestro-property-value]") ?? element : element;
    atom.setAttribute("data-maestro-wanded", found.kind);
  }
}
