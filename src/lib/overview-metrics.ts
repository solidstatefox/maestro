/** Pure, conservative statistics for the built-in FCT result-set Overview.
 * Facet counts describe the current FCT scope (subject to returned facet limits).
 * Per-record statistics are explicitly samples of the loaded results page.
 */
export const OVERVIEW_PERSPECTIVE_URI = "urn:maestro:perspective:overview";

export type OverviewFacet = { uri: string; label: string; count: number };
export type OverviewValue = { value: string; datatype?: string; lang?: string; type?: string };
export type OverviewRecord = {
  uri: string; title: string; termType?: "uri" | "literal" | "bnode"; graph?: string;
  scopeValues?: Array<{ property: string; label: string; direction: "forward" | "reverse"; values: OverviewValue[] }>;
};
export type OverviewDistribution = { name: string; value: number; uri?: string };
export type OverviewPercent = { name: string; percentage: number; count: number; denominator: number; uri?: string };
export type OverviewGeo = { count: number; sample: number; latitude: [number, number]; longitude: [number, number] };
export type OverviewReport = {
  sampleSize: number;
  topClasses: OverviewDistribution[];
  topProperties: OverviewDistribution[];
  topRoles: OverviewDistribution[];
  topGraphs: OverviewDistribution[];
  topLanguages: OverviewDistribution[];
  topValues: OverviewDistribution[];
  topConnected: OverviewDistribution[];
  topCombinations: OverviewDistribution[];
  topNamespaces: OverviewDistribution[];
  exampleRecords: Array<{ uri: string; title: string; kind: string }>;
  termsWithTypes: number;
  termsWithLabels: number;
  sampleWithDescriptions: number;
  sampleWithOutgoing: number;
  byDecade: OverviewDistribution[];
  numericProperties: Array<{ label: string; n: number; min: number; max: number; median: number; q1: number; q3: number }>;
  summary: string;
  /** Percent of the exact FCT population when per-class counts do not exceed the population. Classes overlap. */
  classCoverage: OverviewPercent[];
  /** Composition of returned facet frequencies, NOT share of distinct matching resources. */
  classShares: OverviewPercent[];
  propertyShares: OverviewPercent[];
  roleShares: OverviewPercent[];
  graphShares: OverviewPercent[];
  namespaceShares: OverviewPercent[];
  /** Shares of actually projected values (never extrapolated to unseen results). */
  languageShares: OverviewPercent[];
  valueShares: OverviewPercent[];
  decadeShares: OverviewPercent[];
  connectedShares: OverviewPercent[];
  combinationShares: OverviewPercent[];
  classPropertyShares: OverviewPercent[];
  projectedValueCount: number;
  projectedUriValues: number;
  projectedLiteralValues: number;
  incomingUriLinks: number;
  outgoingUriLinks: number;
  linkedSampleResources: number;
  averageUriLinks: number;
  geo: OverviewGeo | null;
  invalidTypedNumbers: number;
  typedNumberCount: number;
};

const rdfDescription = /(?:#description|\/description|#abstract|\/abstract|#definition|\/definition|#comment)$/i;
const isoDate = /^([12]\d{3})(?:-\d{2}(?:-\d{2})?)?(?:T.*)?$/;
const numericDatatype = /(?:#(?:integer|int|decimal|double|float|long|short|nonNegativeInteger|positiveInteger|unsignedInt|unsignedLong))$/i;
const temporalDatatype = /(?:#(?:date|dateTime|gYear|gYearMonth))$/i;
function ranked(items: OverviewFacet[], max = 10): OverviewDistribution[] {
  return items.filter(item => Number.isFinite(item.count) && item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, max).map(item => ({ name: item.label || item.uri, value: item.count, uri: item.uri }));
}
function fromCounts(counts: Map<string, number>, max = 10): OverviewDistribution[] {
  return [...counts.entries()].filter(([,value]) => value > 0).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))
    .slice(0, max).map(([name,value]) => ({ name,value }));
}
export function percentage(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator < 0) return 0;
  return Math.max(0, Math.min(100, numerator * 100 / denominator));
}
function sumCounts(items: OverviewFacet[]) { return items.reduce((sum, row) => sum + (Number.isFinite(row.count) && row.count > 0 ? row.count : 0), 0); }
function sumMap(items: Map<string,number>) { return [...items.values()].reduce((a,b)=>a+b,0); }
export function sharesOf(items: OverviewDistribution[], denominator: number): OverviewPercent[] {
  if (!Number.isFinite(denominator) || denominator <= 0) return [];
  return items.filter(row => Number.isFinite(row.value) && row.value > 0).map(row => ({
    name: row.name, count: row.value, uri: row.uri, denominator, percentage: percentage(row.value, denominator),
  }));
}
export function buildOverviewReport(input: {
  classes: OverviewFacet[]; properties: OverviewFacet[]; roles: OverviewFacet[]; graphs: OverviewFacet[];
  records: OverviewRecord[]; total: number | null;
}): OverviewReport {
  const { records } = input;
  const byDecade = new Map<string, number>();
  const languages = new Map<string, number>();
  const values = new Map<string, number>();
  const numeric = new Map<string, number[]>();
  const connected = new Map<string, number>();
  const combinations = new Map<string, number>();
  const namespaces = new Map<string, number>();
  const classPropertyPairs = new Map<string, number>();
  let projectedValueCount = 0, projectedUriValues = 0, projectedLiteralValues = 0;
  let incomingUriLinks = 0, outgoingUriLinks = 0, linkedSampleResources = 0;
  let invalidTypedNumbers = 0, typedNumberCount = 0;
  const coords: Array<{lat: number; lon: number}> = [];
  for (const facet of [...input.classes, ...input.properties, ...input.roles]) {
    const hash = facet.uri.lastIndexOf("#"), slash = facet.uri.lastIndexOf("/");
    const boundary = hash >= 0 ? hash + 1 : slash >= 0 ? slash + 1 : 0;
    if (boundary) {
      const namespace = facet.uri.slice(0, boundary);
      namespaces.set(namespace, (namespaces.get(namespace) ?? 0) + 1);
    }
  }
  let termsWithTypes = 0, termsWithLabels = 0, sampleWithDescriptions = 0, sampleWithOutgoing = 0;
  for (const record of records) {
    if (record.termType && record.termType !== "literal") termsWithTypes++;
    if (record.title && record.title !== record.uri) termsWithLabels++;
    const populated = (record.scopeValues ?? []).filter(scope => scope.values.some(value => value.value && value.value !== "-"));
    if (populated.some(scope => scope.direction === "forward")) sampleWithOutgoing++;
    const edges = populated.reduce((sum, scope) => sum + scope.values.filter(value => value.value && value.value !== "-" && value.type === "uri").length, 0);
    if (edges && record.uri) connected.set(record.title || record.uri, (connected.get(record.title || record.uri) ?? 0) + edges);
    if (edges) linkedSampleResources++;
    let lat: number | undefined, lon: number | undefined;
    const classNames = [...new Set((record.scopeValues ?? [])
      .filter(scope => scope.direction === "forward" && /(?:#type|\/type)$/.test(scope.property))
      .flatMap(scope => scope.values.filter(value => value.type === "uri").map(value => value.value)))];
    const propertyNames = [...new Set(populated.filter(scope => scope.direction === "forward").map(scope => scope.label || scope.property))].sort();
    for (const klass of classNames) for (const property of propertyNames.slice(0, 12)) {
      const localClass = klass.split(/[#/]/).pop() || klass;
      const pair = `${localClass} → ${property}`;
      classPropertyPairs.set(pair, (classPropertyPairs.get(pair) ?? 0) + 1);
    }
    for (let i = 0; i < propertyNames.length; i++) for (let j = i + 1; j < propertyNames.length && j < i + 5; j++) {
      const combination = `${propertyNames[i]} + ${propertyNames[j]}`;
      combinations.set(combination, (combinations.get(combination) ?? 0) + 1);
    }
    if (record.scopeValues?.some(scope => rdfDescription.test(scope.property) && scope.values.some(value => value.value && value.value !== "-"))) sampleWithDescriptions++;
    for (const scope of record.scopeValues ?? []) {
      for (const term of scope.values) {
        if (!term.value || term.value === "-") continue;
        projectedValueCount++;
        if (term.type === "uri" || term.type === "bnode") {
          projectedUriValues++;
          if (scope.direction === "reverse") incomingUriLinks++;
          else outgoingUriLinks++;
        } else projectedLiteralValues++;
        if (scope.direction === "forward" && /(?:#lat|\/lat|\/latitude|#latitude)$/i.test(scope.property)) {
          const n = Number(term.value); if (Number.isFinite(n) && n >= -90 && n <= 90) lat = n;
        }
        if (scope.direction === "forward" && /(?:#long|#lon|\/long|\/lon|\/longitude|#longitude)$/i.test(scope.property)) {
          const n = Number(term.value); if (Number.isFinite(n) && n >= -180 && n <= 180) lon = n;
        }
        if (term.lang) languages.set(term.lang, (languages.get(term.lang) ?? 0) + 1);
        if (term.type !== "uri" && term.type !== "bnode" && term.value.length <= 80 && !/^https?:\/\//.test(term.value)) {
          const text = `${scope.label || scope.property}: ${term.value}`;
          values.set(text, (values.get(text) ?? 0) + 1);
        }
        if (temporalDatatype.test(term.datatype ?? "") || /(?:date|year|time)$/i.test(scope.label)) {
          const dateMatch = isoDate.exec(term.value);
          if (dateMatch) {
            const decade = `${Math.floor(Number(dateMatch[1]) / 10) * 10}s`;
            byDecade.set(decade, (byDecade.get(decade) ?? 0) + 1);
          }
        }
        if (numericDatatype.test(term.datatype ?? "")) {
          typedNumberCount++;
          const n = Number(term.value);
          if (!Number.isFinite(n)) invalidTypedNumbers++;
          if (Number.isFinite(n)) (numeric.get(scope.label || scope.property) ?? numeric.set(scope.label || scope.property, []).get(scope.label || scope.property)!).push(n);
        }
      }
    }
    if (lat !== undefined && lon !== undefined) coords.push({lat,lon});
  }
  const topClasses = ranked(input.classes), topProperties = ranked(input.properties), topRoles = ranked(input.roles), topGraphs = ranked(input.graphs);
  const total = input.total;
  const classCoverage = sharesOf(topClasses, total && total > 0 ? total : 0)
    .filter(row => row.count <= row.denominator);
  const classShares = sharesOf(topClasses, sumCounts(input.classes));
  const propertyShares = sharesOf(topProperties, sumCounts(input.properties));
  const roleShares = sharesOf(topRoles, sumCounts(input.roles));
  const graphShares = sharesOf(topGraphs, sumCounts(input.graphs));
  const namespaceShares = sharesOf(fromCounts(namespaces), sumMap(namespaces));
  const languageShares = sharesOf(fromCounts(languages), sumMap(languages));
  const valueShares = sharesOf(fromCounts(values), sumMap(values));
  const decadeShares = sharesOf([...byDecade].sort(([a], [b]) => a.localeCompare(b)).map(([name,value]) => ({name,value})), sumMap(byDecade));
  const connectedShares = sharesOf(fromCounts(connected), sumMap(connected));
  const combinationShares = sharesOf(fromCounts(combinations), records.length);
  const classPropertyShares = sharesOf(fromCounts(classPropertyPairs), records.length);
  const geo = coords.length ? { count:coords.length, sample:records.length,
    latitude:[Math.min(...coords.map(c=>c.lat)),Math.max(...coords.map(c=>c.lat))] as [number,number],
    longitude:[Math.min(...coords.map(c=>c.lon)),Math.max(...coords.map(c=>c.lon))] as [number,number]} : null;
  const headClass = classCoverage[0];
  const headGraph = graphShares[0];
  const summary = total === 0 ? "The current query has no matching resources." :
    `The current FCT focus ${total === null ? "has an unknown number of matching resources" : `matches ${total.toLocaleString()} resources`}.` +
    (headClass ? ` ${headClass.name} occurs in ${headClass.percentage.toFixed(1)}% of those matches (class memberships may overlap).` :
      topClasses.length ? ` ${topClasses[0].name} leads the returned class frequencies.` : "") +
    (headGraph ? ` ${headGraph.name} contributes ${headGraph.percentage.toFixed(1)}% of returned graph-facet frequencies.` : "") +
    (records.length ? ` Page-level observations below cover ${records.length} loaded result${records.length === 1 ? "" : "s"}, not necessarily the full population.` : "");
  return {
    sampleSize: records.length, topClasses, topProperties, topRoles, topGraphs,
    topLanguages: fromCounts(languages), topValues: fromCounts(values),
    topConnected: fromCounts(connected), topCombinations: fromCounts(combinations), topNamespaces: fromCounts(namespaces),
    exampleRecords: records.slice(0, 8).map(item => ({ uri: item.uri, title: item.title || item.uri, kind: item.termType ?? "uri" })),
    termsWithTypes, termsWithLabels, sampleWithDescriptions, sampleWithOutgoing,
    byDecade: [...byDecade].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({name, value})),
    numericProperties: [...numeric].filter(([, vals]) => vals.length).slice(0, 4).map(([label, vals]) => {
      const sorted = [...vals].sort((a,b) => a-b), center = Math.floor(sorted.length/2);
      const quantile = (fraction: number) => { const pos=(sorted.length-1)*fraction, low=Math.floor(pos), high=Math.ceil(pos); return sorted[low] + (sorted[high]-sorted[low])*(pos-low); };
      return { label, n: sorted.length, min: sorted[0], max: sorted[sorted.length-1], median: sorted.length % 2 ? sorted[center] : (sorted[center-1] + sorted[center])/2, q1:quantile(.25), q3:quantile(.75) };
    }),
    summary, classCoverage, classShares, propertyShares, roleShares, graphShares, namespaceShares,
    languageShares, valueShares, decadeShares, connectedShares, combinationShares, classPropertyShares,
    projectedValueCount, projectedUriValues, projectedLiteralValues, incomingUriLinks, outgoingUriLinks,
    linkedSampleResources, averageUriLinks:records.length ? projectedUriValues / records.length : 0,
    geo, invalidTypedNumbers, typedNumberCount,
  };
}
