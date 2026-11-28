/** Exact predicate clustering inputs from a complete, ordered sequence of
 * distinct (focus resource, predicate) bindings. No partial/Anytime pages.
 * Only one subject's predicates and aggregate tallies are held in memory;
 * individual subject/predicate pairs are not retained.
 */
import { analyzePredicateCounts, type PredicateAnalysis, type PredicateCount, type PredicateOverlap } from "./fct-predicate-analytics";

export type PredicateIncidenceTerm = { type: string; value: string };
export type PredicateIncidenceRow = { subject: PredicateIncidenceTerm; predicate: PredicateIncidenceTerm };

export class PredicateIncidenceAccumulator {
  private lastSubject: string | null = null;
  private lastPredicate = "";
  private readonly subjectPredicates = new Set<string>();
  private readonly seen = new Set<string>();
  private readonly counts = new Map<string, number>();
  private readonly overlaps = new Map<string, number>();
  private population = 0;
  private received = 0;
  private exhausted = false;

  constructor(private readonly maxCandidates: number, private readonly maxRows: number) {
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || !Number.isSafeInteger(maxRows) || maxRows < 1)
      throw new Error("Invalid predicate incidence work budget.");
  }

  /** Returns true only after a successful complete short/empty page. A page of
   * exactly pageSize is *not* proof of exhaustion; the caller must fetch more.
   */
  addPage(rows: readonly PredicateIncidenceRow[], pageSize: number): boolean {
    if (this.exhausted) throw new Error("Predicate incidence already complete.");
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || rows.length > pageSize)
      throw new Error("Invalid predicate incidence page size.");
    if (this.received + rows.length > this.maxRows)
      throw new Error(`Exact predicate incidence exceeds the configured ${this.maxRows} rows. Increase maxIncidenceRows in this provider's IndexedDB cubby or narrow the FCT population; no partial clusters were produced.`);
    for (const row of rows) {
      // SPARQL JSON blank-node labels are response-local. They cannot serve as
      // stable identities across independently fetched pagination requests.
      if (!row?.subject || row.subject.type !== "uri" || !row.subject.value)
        throw new Error("Exact paginated predicate incidence requires URI focus resources; response-local blank nodes cannot be joined across pages.");
      if (!row?.predicate || row.predicate.type !== "uri" || !row.predicate.value)
        throw new Error("Invalid predicate incidence: expected an RDF predicate IRI.");
      const subject = row.subject.value, predicate = row.predicate.value;
      if (this.lastSubject !== null && (subject < this.lastSubject ||
          (subject === this.lastSubject && predicate <= this.lastPredicate)))
        throw new Error("Predicate incidence pagination is duplicated or out of order; refusing an unreliable exact analysis.");
      if (subject !== this.lastSubject && this.lastSubject !== null) this.finishSubject();
      this.lastSubject = subject;
      this.lastPredicate = predicate;
      this.subjectPredicates.add(predicate);
      this.seen.add(predicate);
      if (this.seen.size > this.maxCandidates)
        throw new Error(`Predicate population exceeds the configured ${this.maxCandidates} distinct properties. Increase maxCandidates in this provider's IndexedDB cubby or narrow the FCT population.`);
    }
    this.received += rows.length;
    this.exhausted = rows.length < pageSize;
    return this.exhausted;
  }

  /** The last short/empty page must have returned HTTP 200 with complete JSON. */
  result(cutoff: number, rankOnly = false): PredicateAnalysis {
    if (!this.exhausted) throw new Error("Predicate incidence is not complete; no exact clusters can be published.");
    if (this.lastSubject !== null) {
      this.finishSubject();
      this.lastSubject = null;
    }
    const candidates: PredicateCount[] = [...this.counts].map(([uri, subjects]) => ({uri, subjects}));
    const overlaps: PredicateOverlap[] = [...this.overlaps].map(([key, sharedSubjects]) => {
      const [left, right] = JSON.parse(key) as [string, string];
      return {left, right, sharedSubjects};
    });
    return analyzePredicateCounts(candidates, overlaps, this.population, cutoff, rankOnly);
  }

  get rowsReceived(): number { return this.received; }

  private finishSubject(): void {
    const predicates = [...this.subjectPredicates].sort();
    if (!predicates.length) return;
    this.population++;
    for (const property of predicates) this.counts.set(property, (this.counts.get(property) ?? 0) + 1);
    for (let i = 0; i < predicates.length; i++) {
      for (let j = i + 1; j < predicates.length; j++) {
        const key = JSON.stringify([predicates[i], predicates[j]]);
        this.overlaps.set(key, (this.overlaps.get(key) ?? 0) + 1);
      }
    }
    this.subjectPredicates.clear();
  }
}
