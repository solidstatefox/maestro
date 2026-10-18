/**
 * Public query API. UI code reads the subscribed snapshot and performs mutations
 * through named operations exposed by useFctQuery(). Generic node operations are
 * available for schema-level edits; domain-specific operations preserve app
 * invariants such as scope and active-view placement.
 */
export { useFctQuery, serializeFctQuery, attachViewToPropertyInQueryTree } from "./fct-query";
export type {
  FctQueryNode,
  FctQueryTree,
  FctQueryState,
  FctNodeName,
  FctValue,
  FctValueInput,
} from "./fct-query";
