/** Stable UI furniture identities. Dynamic widgets are not registered here:
 * their URN is deterministically derived from the FCT XML node `id`.
 * Existing gttp component references are retained for saved provenance.
 */
export const UI_COMPONENT = {
  recordPolicyDiscovery: "gttp://ggg.maestro.ui/component/record-policy-discovery",
  perspectiveRibbon: "gttp://ggg.maestro.ui/component/view-ribbon",
  policiesFeature: "gttp://ggg.maestro.ui/component/policies-feature",
  otcDispatch: "urn:maestro:component:chat:transcode",
  appbar: "urn:maestro:component:appbar",
  viewRibbon: "urn:maestro:component:view:ribbon",
  personalPane: "urn:maestro:component:left:personal",
  categories: "urn:maestro:component:left:categories",
} as const;

/** Namespaces are the only fixed vocabulary for dynamic components.
 * The node identity comes from the live serialized FCT tree and is not a
 * second, independently generated UI identifier.
 */
export const UI_DYNAMIC_PREFIX = {
  property: "urn:maestro:component:facet:property:",
  role: "urn:maestro:component:facet:role:",
  categories: "urn:maestro:component:facet:categories:",
} as const;
export type DynamicUiComponentKind = keyof typeof UI_DYNAMIC_PREFIX;

export function dynamicUiComponentUrn(kind: DynamicUiComponentKind, xmlNodeId: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_.:%-]{0,255}$/.test(xmlNodeId)) {
    throw new Error("A valid FCT node ID is required for a dynamic component URN.");
  }
  return `${UI_DYNAMIC_PREFIX[kind]}${xmlNodeId}`;
}
