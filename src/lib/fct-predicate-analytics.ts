/**
 * Pure, deterministic, population-scoped predicate analytics.
 * RDF subject/predicate incidence is reduced within the server-side proxy;
 * only aggregate analysis reaches the FCT client. AHC implements UPGMA
 * (average linkage).
 */
import { MAX_PREDICATE_ANALYSIS_CANDIDATES } from "./fct-view-types";
export { MAX_PREDICATE_ANALYSIS_CANDIDATES } from "./fct-view-types";
export const DEFAULT_PREDICATE_CLUSTER_CUTOFF = 0.55;

export type PredicateCount = { uri: string; subjects: number };
export type PredicateOverlap = { left: string; right: string; sharedSubjects: number };
export type PredicateAnalysis = {
  ranks: Array<{ property: string; rank: number }>;
  assignments: Array<{ property: string; cluster: string }>;
  clusters: Array<{ cluster: string; count: number; sample: string }>;
};

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Normalized binary entropy of predicate presence, in the range [0,1]. */
export function predicatePresenceEntropy(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return 0;
  return -ratio * Math.log2(ratio) - (1 - ratio) * Math.log2(1 - ratio);
}

export function analyzePredicateCounts(
  candidates: readonly PredicateCount[],
  overlaps: readonly PredicateOverlap[],
  populationSize: number,
  cutoff = DEFAULT_PREDICATE_CLUSTER_CUTOFF,
): PredicateAnalysis {
  if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 1) throw new Error("Predicate cluster cutoff must be in [0,1].");
  if (!validCount(populationSize)) throw new Error("Invalid predicate analysis population size.");
  if (candidates.length > MAX_PREDICATE_ANALYSIS_CANDIDATES)
    throw new Error(`Predicate analysis exceeds ${MAX_PREDICATE_ANALYSIS_CANDIDATES} candidates; refusing a partial cluster population.`);
  const sorted = [...candidates].sort((a, b) => a.uri.localeCompare(b.uri, "en"));
  const index = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[i];
    if (!candidate.uri || index.has(candidate.uri) || !validCount(candidate.subjects) || candidate.subjects > populationSize)
      throw new Error("Invalid or duplicate predicate population count.");
    index.set(candidate.uri, i);
  }
  const n = sorted.length;
  if (!n) return { ranks: [], assignments: [], clusters: [] };
  const distances: number[][] = Array.from({ length: n }, () => Array(n).fill(1));
  for (let i = 0; i < n; i++) distances[i][i] = 0;
  const visitedPairs = new Set<string>();
  for (const row of overlaps) {
    const i = index.get(row.left);
    const j = index.get(row.right);
    if (i === undefined || j === undefined || i === j || !validCount(row.sharedSubjects))
      throw new Error("Invalid predicate overlap row.");
    const [a, b] = i < j ? [i, j] : [j, i];
    const key = `${a}:${b}`;
    if (visitedPairs.has(key)) throw new Error("Duplicate predicate overlap row.");
    visitedPairs.add(key);
    const union = sorted[i].subjects + sorted[j].subjects - row.sharedSubjects;
    if (row.sharedSubjects > Math.min(sorted[i].subjects, sorted[j].subjects) || union <= 0)
      throw new Error("Inconsistent predicate overlap counts.");
    const d = 1 - row.sharedSubjects / union;
    distances[a][b] = d;
    distances[b][a] = d;
  }
  // A complete grouped SPARQL response omits zero-overlap pairs. Those cells
  // intentionally remain distance=1; incomplete queries must be rejected upstream.
  const connectivity = sorted.map((_, i) => n === 1 ? 0 :
    distances[i].reduce((sum, distance, j) => sum + (i === j ? 0 : 1 - distance), 0) / (n - 1));
  const scores = sorted.map((candidate, i) => {
    const coverage = populationSize ? candidate.subjects / populationSize : 0;
    return 0.35 * coverage + 0.45 * predicatePresenceEntropy(coverage) + 0.20 * connectivity[i];
  });
  const sortedRanks = sorted.map((v, i) => ({ property: v.uri, score: scores[i], subjects: v.subjects }))
    .sort((a, b) => b.score - a.score || b.subjects - a.subjects || (a.property < b.property ? -1 : a.property > b.property ? 1 : 0));
  const ranks = sortedRanks.map(({ property }, i) => ({ property, rank: i + 1 }));
  const rankIndex = new Map(ranks.map(row => [row.property, row.rank]));

  // Average-linkage agglomeration with Lance-Williams size-weighted updates.
  // The configured ceiling bounds the cubic scan. Exact RDF incidence
  // is accumulated within the proxy, not in the browser.
  type Group = { indices: number[]; size: number; id: number };
  const groups = new Map<number, Group>(sorted.map((_, i) => [i, { indices: [i], size: 1, id: i }]));
  const dis = new Map<number, Map<number, number>>();
  for (let i = 0; i < n; i++) dis.set(i, new Map(sorted.map((_, j) => [j, distances[i][j]])));
  let nextId = n;
  while (groups.size > 1) {
    const ids = [...groups.keys()].sort((a, b) => a - b);
    let bestA = -1, bestB = -1, best = Infinity;
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const d = dis.get(ids[a])?.get(ids[b]) ?? Infinity;
        if (d < best - 1e-12 || (Math.abs(d - best) <= 1e-12 && (bestA < 0 || ids[a] < bestA || (ids[a] === bestA && ids[b] < bestB)))) {
          best = d; bestA = ids[a]; bestB = ids[b];
        }
      }
    }
    if (bestA < 0 || best > cutoff + 1e-12) break;
    const a = groups.get(bestA)!;
    const b = groups.get(bestB)!;
    const newDistances = new Map<number, number>();
    for (const otherId of ids) {
      if (otherId === bestA || otherId === bestB) continue;
      const ad = dis.get(bestA)!.get(otherId)!;
      const bd = dis.get(bestB)!.get(otherId)!;
      newDistances.set(otherId, (a.size * ad + b.size * bd) / (a.size + b.size));
    }
    groups.delete(bestA);
    groups.delete(bestB);
    dis.delete(bestA);
    dis.delete(bestB);
    for (const [otherId, distance] of newDistances) {
      dis.get(otherId)!.delete(bestA);
      dis.get(otherId)!.delete(bestB);
      dis.get(otherId)!.set(nextId, distance);
    }
    dis.set(nextId, newDistances);
    groups.set(nextId, { id: nextId, size: a.size + b.size, indices: [...a.indices, ...b.indices] });
    nextId++;
  }
  const finished = [...groups.values()].map(group => {
    const members = group.indices.map(i => sorted[i].uri).sort();
    const sample = members.slice().sort((a, b) => (rankIndex.get(a)! - rankIndex.get(b)!) || a.localeCompare(b, "en"))[0];
    return { members, sample };
  }).sort((a, b) => (rankIndex.get(a.sample)! - rankIndex.get(b.sample)!) || a.sample.localeCompare(b.sample, "en"));
  const assignments = finished.flatMap((group, i) => group.members.map(property => ({property, cluster: `C${i + 1}`})))
    .sort((a, b) => (rankIndex.get(a.property)! - rankIndex.get(b.property)!));
  const clusters = finished.map((group, i) => ({ cluster: `C${i + 1}`, count: group.members.length, sample: group.sample }));
  return { ranks, assignments, clusters };
}

export function predicateAnalysisPage(analysis: PredicateAnalysis, view: "properties-rank" | "properties-cluster" | "clusters", offset: number, limit: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid predicate analytics page.");
  if (view === "properties-rank") return analysis.ranks.slice(offset, offset + limit);
  if (view === "properties-cluster") return analysis.assignments.slice(offset, offset + limit);
  return analysis.clusters.slice(offset, offset + limit);
}
