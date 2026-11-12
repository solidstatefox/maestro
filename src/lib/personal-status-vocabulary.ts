/** Shared URI-valued Personal status vocabulary. */
export const MUI_NS = "gttp://ggg.maestro.ecosys/ns/ui#";
export const MUI_STATUS = `${MUI_NS}status`;
export const MUI_LAST_LOCATED_AT = `${MUI_NS}lastLocatedAt`;
export const RECORD_STATUSES = {
  Starred: `${MUI_NS}Starred`,
  Seen: `${MUI_NS}Seen`,
  Unseen: `${MUI_NS}Unseen`,
} as const;
export const MUI_HIDDEN = `${MUI_NS}Hidden`;
export type RecordStatusName = keyof typeof RECORD_STATUSES;
export type StatusFacetName = RecordStatusName | "New" | "Hidden";
export const RECORD_STATUS_NAMES: StatusFacetName[] = ["New", "Seen", "Starred", "Hidden"];
export function isRecordStatusName(value: unknown): value is RecordStatusName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RECORD_STATUSES, value);
}
