/**
 * Derive the visible relationship breadcrumb trail from the current live FCT
 * query. The optional ghost suffix is presentation-only; it must never retain
 * identities from a previous query when a full query replacement reuses IDs.
 *
 * This runs for every subscribed FCT query change. Callers (Wand, History,
 * bookmarks, Configure, etc.) do not synchronize breadcrumbs themselves.
 */
import type { FctQueryNode, FctQueryTree } from "./fct-query-api";

export type FctBreadcrumb = { id: string; uri: string; name: string };

export type FctBreadcrumbReconciliation = {
  trail: FctBreadcrumb[];
  scopeSignatures: Map<string, string[]>;
  retainedAncestorGhost: boolean;
};

/** IDs are stable within a query, not a semantic identity across replacements. */
function relationshipSignature(node: FctQueryNode): string {
  return JSON.stringify([node.id, node.name, node.attributes.iri ?? ""]);
}

export function reconcileFctBreadcrumbTrail(
  tree: FctQueryTree,
  activePath: readonly FctBreadcrumb[],
  previousTrail: readonly FctBreadcrumb[],
  previousScopeSignatures: ReadonlyMap<string, readonly string[]>,
  retainAncestorGhost: boolean,
): FctBreadcrumbReconciliation {
  const scopes = new Map<string, FctQueryNode[]>([["query-root", []]]);
  const collect = (nodes: FctQueryNode[], nearestRelationshipId: string) => {
    for (const node of nodes) {
      const isRelationship = (node.name === "property" || node.name === "property-of") &&
        Boolean(node.attributes.iri?.trim());
      if (isRelationship) {
        scopes.get(nearestRelationshipId)!.push(node);
        scopes.set(node.id, []);
        collect(node.children, node.id);
      } else {
        // Non-relationship nodes (e.g. class/status filters) do not become
        // breadcrumbs. Match the FCT view-path API's nearest relationship path.
        collect(node.children, nearestRelationshipId);
      }
    }
  };
  collect(tree.children, "query-root");

  const scopeSignatures = new Map(Array.from(scopes, ([id, nodes]) =>
    [id, nodes.map(relationshipSignature)] as const,
  ));

  // The ghost suffix is valid only as a *connected property path* in this
  // query. Checking just the node IDs preserved stale breadcrumbs after
  // replaceTree() reused the same compact base-36 IDs for different bindings.
  const retained: FctBreadcrumb[] = [];
  let parentId = "query-root";
  for (const crumb of previousTrail) {
    const node = (scopes.get(parentId) ?? []).find((candidate) =>
      candidate.id === crumb.id && candidate.name === crumb.name && candidate.attributes.iri === crumb.uri,
    );
    if (!node) break;
    retained.push({ id: node.id, uri: node.attributes.iri!, name: node.name });
    parentId = node.id;
  }

  const activeIsPrefix = activePath.length <= retained.length &&
    activePath.every((crumb, index) =>
      crumb.id === retained[index]?.id && crumb.name === retained[index]?.name && crumb.uri === retained[index]?.uri,
    );
  let trail = activeIsPrefix ? retained : [...activePath];

  // Keep the muted suffix while the user deliberately navigates to an
  // ancestor, but not if any relationship in that suffix disappeared/changed.
  if (retainAncestorGhost && trail.length > activePath.length) {
    return { trail, scopeSignatures, retainedAncestorGhost: true };
  }

  const scopeId = activePath[activePath.length - 1]?.id ?? "query-root";
  const siblings = scopes.get(scopeId) ?? [];
  const previousSiblings = previousScopeSignatures.get(scopeId) ?? [];
  const newlyAdded = siblings.filter((node) => !previousSiblings.includes(relationshipSignature(node)));
  // Preserve existing Configure behavior: an added sibling appears as the
  // single ghost successor without relocating <view>.
  const candidate = newlyAdded[newlyAdded.length - 1] ??
    (trail.length <= activePath.length ? siblings[siblings.length - 1] : undefined);
  if (candidate) {
    trail = [...activePath, { id: candidate.id, uri: candidate.attributes.iri ?? "", name: candidate.name }];
  }
  return { trail, scopeSignatures, retainedAncestorGhost: false };
}
