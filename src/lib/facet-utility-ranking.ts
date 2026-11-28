/** Facet Utility Ranking (FUR). Exact counts, not OWL declarations or samples.
 * Each histogram row describes `frequency` distinct RDF values, each with
 * `count` distinct focus resources. No RDF values need to leave the endpoint.
 */
import type { PredicateAnalysis, PredicateCount } from "./fct-predicate-analytics";

export type FacetValueFrequency = { uri: string; count: number; frequency: number };
const positiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0;

/** Zero for singleton and universal values; maximum near half the population. */
export function facetValueUtility(count: number, population: number): number {
  if (!positiveInteger(population) || !positiveInteger(count) || count > population)
    throw new Error("Invalid facet value count.");
  if (population === 1) return 0;
  return 4 * ((count - 1) / (population - 1)) * ((population - count) / (population - 1));
}

/** Population coverage × frequency-weighted mean value utility.
 * Normalize by the total number of distinct subject/value memberships, so
 * adding multiple values to a resource cannot multiply its property's score.
 * Coverage is counted independently, not inferred by summing overlapping values.
 */
export function rankFacetUtility(
  population: number, coverage: readonly PredicateCount[], histogram: readonly FacetValueFrequency[],
): PredicateAnalysis["ranks"] {
  if (!Number.isSafeInteger(population) || population < 0) throw new Error("Invalid FUR population.");
  const stats = new Map<string, { subjects: number; memberships: number; utility: number; counts: Set<number> }>();
  for (const {uri, subjects} of coverage) {
    if (!uri || stats.has(uri) || !positiveInteger(subjects) || subjects > population)
      throw new Error("Invalid or duplicate FUR property coverage.");
    stats.set(uri, { subjects, memberships: 0, utility: 0, counts: new Set() });
  }
  for (const {uri, count, frequency} of histogram) {
    const stat = stats.get(uri);
    if (!stat || !positiveInteger(count) || count > stat.subjects || !positiveInteger(frequency) || stat.counts.has(count))
      throw new Error("Invalid or duplicate FUR value-frequency row.");
    const memberships = count * frequency;
    if (!positiveInteger(memberships) || !Number.isSafeInteger(stat.memberships + memberships))
      throw new Error("FUR membership count exceeds the safe integer range.");
    stat.counts.add(count);
    stat.memberships += memberships;
    stat.utility += memberships * facetValueUtility(count, population);
  }
  const ranked = [...stats].map(([property, stat]) => {
    if (stat.memberships < stat.subjects) throw new Error("Incomplete FUR value frequencies for property.");
    return { property, subjects: stat.subjects,
      score: (stat.subjects / population) * (stat.utility / stat.memberships) };
  }).sort((a,b) => b.score - a.score || b.subjects - a.subjects || (a.property < b.property ? -1 : a.property > b.property ? 1 : 0));
  return ranked.map(({property}, index) => ({property, rank: index + 1}));
}

export class FacetUtilityStatisticsError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

type StatisticsStage = {kind: "population"} | {kind: "coverage" | "value-counts"; offset: number; limit: number};
type StatisticsRow = Record<string, {type: string; value: string} | undefined>;

/** Consume only complete pages supplied by the transport. This owns the
 * work-budget checks, pagination and cancellation, not network dispatch. */
export async function collectFacetUtilityRanking(
  readPage: (stage: StatisticsStage) => Promise<readonly StatisticsRow[]>,
  maxCandidates: number, maxValueGroups: number, signal: AbortSignal,
  pageSize = 500,
): Promise<PredicateAnalysis["ranks"]> {
  if (![maxCandidates, maxValueGroups, pageSize].every(positiveInteger) || pageSize > 1000)
    throw new FacetUtilityStatisticsError("Invalid FUR work budget.");
  const read = async (stage: StatisticsStage) => {
    signal.throwIfAborted();
    const rows = await readPage(stage);
    signal.throwIfAborted();
    return rows;
  };
  const integer = (term: StatisticsRow[string] | undefined, field: string): number => {
    if (!term || (term.type !== "literal" && term.type !== "typed-literal") || !/^\d+$/.test(term.value) || !Number.isSafeInteger(Number(term.value)))
      throw new FacetUtilityStatisticsError(`Invalid FUR ${field}.`);
    return Number(term.value);
  };
  const populationRows = await read({kind:"population"});
  if (populationRows.length !== 1) throw new FacetUtilityStatisticsError("Invalid FUR population count response.");
  const population = integer(populationRows[0].n, "population");
  if (population === 0) return [];
  const coverage: PredicateCount[] = [];
  const histogram: FacetValueFrequency[] = [];
  const known = new Set<string>();
  const groups = new Map<string, Set<number>>();
  let values = 0;
  for (const kind of ["coverage", "value-counts"] as const) {
    for (let offset = 0; ; offset += pageSize) {
      const rows = await read({kind, offset, limit:pageSize});
      if (rows.length > pageSize) throw new FacetUtilityStatisticsError("Invalid FUR statistics page size.");
      for (const row of rows) {
        if (row.maestroPredicate?.type !== "uri" || !row.maestroPredicate.value)
          throw new FacetUtilityStatisticsError("Invalid FUR predicate IRI.");
        const uri = row.maestroPredicate.value;
        const count = integer(row.n, "distinct subject count");
        if (count < 1 || count > population) throw new FacetUtilityStatisticsError("Invalid FUR distinct subject count.");
        if (kind === "coverage") {
          if (known.has(uri)) throw new FacetUtilityStatisticsError("Duplicate FUR property coverage; inconsistent pages.");
          if (coverage.length >= maxCandidates)
            throw new FacetUtilityStatisticsError(`FUR exceeds the configured ${maxCandidates} distinct properties. Increase maxCandidates or narrow the FCT population.`, 422);
          known.add(uri);
          coverage.push({uri,subjects:count});
        } else {
          if (!known.has(uri)) throw new FacetUtilityStatisticsError("FUR value frequency has no matching property coverage.");
          const seen = groups.get(uri) ?? new Set<number>();
          if (seen.has(count)) throw new FacetUtilityStatisticsError("Duplicate FUR value-frequency row; inconsistent pages.");
          seen.add(count); groups.set(uri, seen);
          const frequency = integer(row.frequency, "value frequency");
          if (frequency < 1) throw new FacetUtilityStatisticsError("Invalid FUR value frequency.");
          values += frequency;
          if (!Number.isSafeInteger(values) || values > maxValueGroups)
            throw new FacetUtilityStatisticsError(`Exact FUR statistics exceed the configured ${maxValueGroups} distinct predicate/value groups. Increase maxIncidenceRows or narrow the FCT population; no partial ranking was produced.`, 422);
          histogram.push({uri,count,frequency});
        }
      }
      if (rows.length < pageSize) break;
    }
  }
  signal.throwIfAborted();
  try { return rankFacetUtility(population, coverage, histogram); }
  catch (err) { throw new FacetUtilityStatisticsError(err instanceof Error ? err.message : "Invalid FUR statistics."); }
}
