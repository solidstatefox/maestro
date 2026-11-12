/** Canonical XML <view type="…"> values supported by Maestro's FCT translator.
 * Keep these wire-format strings stable: saved queries, URLs, and policies use them.
 */
export const FCT_VIEW_TYPES = {
  TEXT: "text",
  PROPERTIES: "properties",
  PROPERTIES_IN: "properties-in",
  CLASSES: "classes",
  LIST: "list",
  LIST_SUBJECTS: "list-subjects",
  LIST_OBJECTS: "list-objects",
  LIST_VALUES: "list-values",
  LIST_STATUS: "list-status",
  ASK: "ask",
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
