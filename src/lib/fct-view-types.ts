/** Canonical XML <view type="…"> values supported by Maestro's FCT translator.
 * Keep these wire-format strings stable: saved queries, URLs, and policies use them.
 */
export const FCT_VIEW_TYPES = {
  TEXT: "text",
  PROPERTIES: "properties",
  PROPERTIES_IN: "properties-in",
  PROPERTIES_RANK: "properties-rank",
  PROPERTIES_SYNSET: "properties-synset",
  PROPERTIES_CLUSTER: "properties-cluster",
  CLUSTERS: "clusters",
  CLASSES: "classes",
  LIST: "list",
  LIST_SUBJECTS: "list-subjects",
  LIST_OBJECTS: "list-objects",
  LIST_VALUES: "list-values",
  MERGE_VALUES: "merge-values",
  VALIDATE: "validate",
  LIST_STATUS: "list-status",
  ASK: "ask",
  COUNT_DISTINCT: "count-distinct",
  LIST_COUNT: "list-count",
  ALPHABET: "alphabet",
  GEO: "geo",
  YEARS: "years",
  MONTHS: "months",
  WEEKS: "weeks",
  DAYS: "days",
  DESCRIBE: "describe",
  GRAPHS: "graphs",
} as const;

/** An explicit view timeout is a Virtuoso execution budget in milliseconds.
 * Omit the attribute to inherit the Sheet/query default. */
export function parseFctViewTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const timeout = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 2147483647)
    throw new Error("FCT view timeout must be an integer from 1000 to 2147483647 milliseconds.");
  return timeout;
}

/** A view type is always derived from the canonical constants. */
export type FctViewType = (typeof FCT_VIEW_TYPES)[keyof typeof FCT_VIEW_TYPES];

export const FCT_VIEW_TYPE_VALUES: readonly FctViewType[] = Object.values(FCT_VIEW_TYPES);

export function isFctViewType(value: string): value is FctViewType {
  return FCT_VIEW_TYPE_VALUES.some((type) => type === value);
}

/** Maximum number of complete predicates admitted to one scoped analytics run. */
export const DEFAULT_PREDICATE_ANALYSIS_CANDIDATES = 200;
/** Safety ceiling for user-selected analytical populations; distinct from view pagination. */
export const MAX_PREDICATE_ANALYSIS_CANDIDATES = 1000;

/** Maximum complete subject/predicate incidence rows per predicate analysis.
 * This is a work budget, not an implicit sample size: exceeding it fails closed. */
export const DEFAULT_PREDICATE_ANALYSIS_INCIDENCE_ROWS = 50000;
export const MAX_PREDICATE_ANALYSIS_INCIDENCE_ROWS = 500000;

/** Ranking is independent of shared-subject clustering. */
export const PREDICATE_RANK_ALGORITHMS = ["fur", "structural"] as const;
export type PredicateRankAlgorithm = (typeof PREDICATE_RANK_ALGORITHMS)[number];
export const DEFAULT_PREDICATE_RANK_ALGORITHM: PredicateRankAlgorithm = "fur";
export function predicateRankAlgorithm(value: string | undefined): PredicateRankAlgorithm {
  if (value === undefined) return DEFAULT_PREDICATE_RANK_ALGORITHM;
  if (value === "fur" || value === "structural") return value;
  throw new Error("Predicate ranking algorithm must be fur or structural.");
}

/** Synset scoring is independent of predicate ranking and clustering. */
export const PREDICATE_SYNSET_ALGORITHMS = ["relation-agreement", "rulealign"] as const;
export type PredicateSynsetAlgorithm = (typeof PREDICATE_SYNSET_ALGORITHMS)[number];
export function predicateSynsetAlgorithm(value: string | undefined): PredicateSynsetAlgorithm {
  if (value === undefined || value === "relation-agreement") return "relation-agreement";
  if (value === "rulealign") return value;
  throw new Error("Property synset algorithm must be relation-agreement or rulealign.");
}
