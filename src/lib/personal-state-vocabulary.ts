/** Shared URI-valued Personal state vocabulary. */
export const MUI_NS = "gttp://ggg.maestro.ecosys/ns/ui#";
export const MUI_STATE = `${MUI_NS}state`;
export const MUI_LAST_LOCATED_AT = `${MUI_NS}lastLocatedAt`;
export const RECORD_STATES = {
  Starred: `${MUI_NS}Starred`,
  Seen: `${MUI_NS}Seen`,
  Unseen: `${MUI_NS}Unseen`,
} as const;
export const MUI_HIDDEN = `${MUI_NS}Hidden`;
export type RecordStateName = keyof typeof RECORD_STATES;
export type StateFacetName = RecordStateName | "New" | "Hidden";
export const RECORD_STATE_NAMES: StateFacetName[] = ["New", "Seen", "Starred", "Hidden"];
export function isRecordStateName(value: unknown): value is RecordStateName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RECORD_STATES, value);
}
