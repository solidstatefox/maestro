/** Predicate Clusters Analysis: strict join of the three independent FCT views.
 * This module contains no React or I/O and never invents missing membership.
 */
export const PREDICATE_CLUSTERS_ANALYSIS_URI = "gttp://ggg.maestro.ecosys/analyze/predicate-clusters";
export const PREDICATE_CLUSTER_VIEW_NAMES = ["properties-rank", "properties-cluster", "clusters"] as const;
export type PredicateClusterView = (typeof PREDICATE_CLUSTER_VIEW_NAMES)[number];
export type AnalyticCell = { value: string; termType?: string; label?: string; attributes: Record<string, string> };
export type AnalyticPage = { viewType: string; complete: string; incomplete: boolean; rows: AnalyticCell[][]; error?: string };
export type RankedProperty = { uri: string; label: string; rank: number; cluster: string };
export type PropertyCluster = { id: string; count: number; sampleUri: string; sampleLabel: string; members: RankedProperty[] };
export type PredicateClusterAnalysis = { ranks: RankedProperty[]; clusters: PropertyCluster[] };

function read(page: AnalyticPage, expected: PredicateClusterView, names: readonly string[]): Map<string, string>[] {
  if (page.error || page.viewType !== expected || page.complete !== "yes" || page.incomplete)
    throw new Error(`Incomplete ${expected} FCT result${page.error ? `: ${page.error}` : ""}.`);
  return page.rows.map(row => {
    const terms = new Map(row.map(cell => [cell.attributes.var, cell.value]));
    if (row.length !== names.length || names.some(name => !terms.has(name)))
      throw new Error(`Invalid ${expected} row columns.`);
    return terms;
  });
}
function positiveInteger(s: string | undefined, field: string): number {
  if (!s || !/^[1-9]\d*$/.test(s)) throw new Error(`Invalid ${field}.`);
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new Error(`Unsafe ${field}.`);
  return n;
}
// The proxy already obtained these cells as RDF URI terms; a URI's display
// identity is not restricted to the SPARQL <IRIREF> grammar. In particular,
// do not reject a valid server-returned predicate merely for containing '|'.
const iri = (s: string | undefined): s is string => Boolean(s &&
  /^[a-z][a-z\d+.-]*:/i.test(s) && !/[\u0000-\u001f]/u.test(s));

/** All views must refer to the exact same complete, population-scoped run. */
export function joinPredicateClusterViews(
  rank: AnalyticPage, membership: AnalyticPage, summary: AnalyticPage,
  algorithm: "fur" | "structural" = "structural",
): PredicateClusterAnalysis {
  const rankRows = read(rank, "properties-rank", ["c1", "rank"]);
  const assignmentRows = read(membership, "properties-cluster", ["c1", "cluster"]);
  const summaryRows = read(summary, "clusters", ["c1", "n", "sample", "sampleLabel"]);
  const membershipByProperty = new Map<string, string>();
  for (const row of assignmentRows) {
    const uri = row.get("c1"); const cluster = row.get("cluster");
    if (!iri(uri) || !cluster || membershipByProperty.has(uri)) throw new Error("Invalid or repeated cluster membership.");
    membershipByProperty.set(uri, cluster);
  }
  const ranks: RankedProperty[] = [];
  const rankNumbers = new Set<number>();
  const properties = new Set<string>();
  for (const row of rankRows) {
    const uri = row.get("c1"); const rankNo = positiveInteger(row.get("rank"), "property rank");
    const cluster = uri ? membershipByProperty.get(uri) : undefined;
    if (!iri(uri) || !cluster || properties.has(uri) || rankNumbers.has(rankNo))
      throw new Error("Ranking disagrees with cluster membership.");
    properties.add(uri); rankNumbers.add(rankNo);
    const first = rank.rows.find(cells => cells.some(c => c.attributes.var === "c1" && c.value === uri))?.find(c => c.attributes.var === "c1");
    ranks.push({ uri, label: first?.label || first?.attributes.shortform || uri.split(/[\/#]/).pop() || uri, rank: rankNo, cluster });
  }
  if (ranks.length !== membershipByProperty.size || rankNumbers.size !== ranks.length ||
      ranks.some(entry => entry.rank > ranks.length))
    throw new Error("The ranked predicate population is incomplete.");
  ranks.sort((a,b) => a.rank-b.rank);
  const byCluster = new Map<string, RankedProperty[]>();
  for (const property of ranks) byCluster.set(property.cluster, [...(byCluster.get(property.cluster) ?? []), property]);
  const clusters: PropertyCluster[] = [];
  const used = new Set<string>();
  for (const row of summaryRows) {
    const id = row.get("c1");
    const count = positiveInteger(row.get("n"), "cluster cardinality");
    const sampleUri = row.get("sample");
    const sampleLabel = row.get("sampleLabel");
    if (!id || used.has(id) || !iri(sampleUri) || !sampleLabel?.trim()) throw new Error("Invalid cluster summary.");
    used.add(id);
    const members = byCluster.get(id) ?? [];
    if (members.length !== count || !members.some(member => member.uri === sampleUri))
      throw new Error(`Cluster ${id} cardinality or sample disagrees with membership.`);
    // Cluster membership, ID and cardinality are structural. FUR only changes
    // the representative shown to the user, using an already resolved rank label.
    const representative = algorithm === "fur" ? members[0] : undefined;
    clusters.push({id,count,sampleUri: representative?.uri ?? sampleUri,
      sampleLabel: representative?.label ?? sampleLabel,members});
  }
  if (used.size !== byCluster.size) throw new Error("The clusters view omitted a cluster.");
  clusters.sort((a,b) => b.count-a.count || a.id.localeCompare(b.id));
  return { ranks, clusters };
}
