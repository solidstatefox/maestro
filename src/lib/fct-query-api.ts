/**
 * Public query API. UI code subscribes to the live source of truth through
 * useFctQuery(). All derived-query construction and transformation is exposed
 * through this module so UI components never edit query trees directly.
 */
export {
  useFctQuery,
  serializeFctQuery,
  attachViewToPropertyInQueryTree,
  fctQueryTreeApi,
} from "./fct-query";
export type {
  FctQueryNode,
  FctQueryTree,
  FctQueryState,
  FctNodeName,
  FctValue,
  FctValueInput,
} from "./fct-query";
export {
  createPropertyWidgetQuery,
  createGroupValuesQuery,
  createGroupMemberQuery,
  createDistinctCountQuery,
} from "./fct-query-derived";
export type { QueryResultValue } from "./fct-query-derived";

export {
  setQueryViewAttributes,
  createRecordDescriptionQuery,
} from "./fct-query-derived";
export type { DistinctCountKind } from "./fct-query-derived";
