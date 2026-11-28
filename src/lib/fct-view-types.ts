/** Canonical XML <view type="…"> values supported by Maestro's FCT translator.
 * Keep these wire-format strings stable: saved queries, URLs, and policies use them.
 */
export const FCT_VIEW_TYPES = {
  TEXT: "text",
  PROPERTIES: "properties",
  PROPERTIES_IN: "properties-in",
  PROPERTIES_RANK: "properties-rank",
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
