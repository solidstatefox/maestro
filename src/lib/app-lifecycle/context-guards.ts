/** Scope predicates shared by Maestro's existing React/FCT lifecycles.
 * These are pure guards, not a second query store or state machine. */
export type ScopedConfigureDraft = { scope: string; changes: Record<string, boolean> };
export const activeConfigureChanges = (draft: ScopedConfigureDraft | null, scope: string): Record<string, boolean> =>
  draft?.scope === scope ? draft.changes : {};
export const isCurrentConfigureDraft = (draft: ScopedConfigureDraft | null, scope: string): boolean =>
  draft === null || draft.scope === scope;
export const canApplyAutoConfigure = (args: {
  scope: string; propertySource: string; roleSource: string; ready: boolean;
  propertiesLoading: boolean; rolesLoading: boolean;
}): boolean => Boolean(args.ready && !args.propertiesLoading && !args.rolesLoading &&
  args.propertySource === args.scope && args.roleSource === args.scope);
export type ProviderApprovalContext = { query: string; panel: string; providerKind: string | null; tab: string };
export const canRefreshApprovedProvider = (current: ProviderApprovalContext, query: string, providerKind: string | null) =>
  current.query === query && current.panel === "providers" && current.providerKind === providerKind && current.tab === "view";
export const validRecordGraphFamily = (selection: string, graphs: readonly string[]) =>
  !selection || graphs.some(graph => graph.split("#", 1)[0] === selection);
export const validRecordAuthorGraph = (selection: string, authors: readonly { graph: string }[]) =>
  !selection || authors.some(author => author.graph === selection);
