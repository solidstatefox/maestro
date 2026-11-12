/** Stable RDF IDs of policy-requesting UI components, published in the SHACL shape graph.
 * They refer to component instances/types, not arbitrary user-supplied strings. */
export const UI_COMPONENT = {
  recordPolicyDiscovery: "gttp://ggg.maestro.ui/component/record-policy-discovery",
  perspectiveRibbon: "gttp://ggg.maestro.ui/component/view-ribbon",
  policiesFeature: "gttp://ggg.maestro.ui/component/policies-feature",
} as const;
