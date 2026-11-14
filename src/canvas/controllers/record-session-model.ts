/**
 * Record-session identity and lifecycle. This module is deliberately free of
 * React, rendering, FCT-tree mutations, and SPARQL text processing.
 *
 * Session zero is the Browse-controlled record. Pivot sessions are disposable.
 * URI and literal identity are ordinary RDF terms; blank-node identity comes
 * from Maestro's existing bnode API (not a persistent _: label).
 */
import type { BNodeRecordAnchor, RdfTermKind } from "@/lib/bnode";
import type { RecordStatement } from "@/canvas/controllers/record-rdfa-decoration";

export type RecordSessionIdentity = {
  value: string;
  termType: RdfTermKind;
  datatype?: string;
  lang?: string;
  /** The existing FCT selection at the time of the pivot. */
  queryXml: string;
  /** For blank nodes, use the existing bnode API to rebind the RDF term. */
  bnodeAnchor?: BNodeRecordAnchor;
  /** Scoped FCT list-values query produced by Maestro’s blank-node API. */
  bnodeQueryXml?: string;
};

export type RecordSessionEdge = {
  predicate: string;
  direction: "property" | "property-of";
  subjectSessionId: string;
};

export type RecordSessionDescriptor = {
  id: string;
  identity: RecordSessionIdentity;
  via?: RecordSessionEdge;
};

export type RecordSessionsSnapshot = {
  sessions: readonly RecordSessionDescriptor[];
  visibleStart: number;
};

/** Owns per-session cancellation without controlling the global live query. */
export class RecordSessionsController {
  private sessions: RecordSessionDescriptor[];
  private visibleStart = 0;
  private nextId = 1;
  private readonly pending = new Map<string, Set<AbortController>>();

  constructor(browseIdentity: RecordSessionIdentity) {
    this.sessions = [{ id: "record-0", identity: browseIdentity }];
  }

  snapshot(): RecordSessionsSnapshot {
    return { sessions: [...this.sessions], visibleStart: this.visibleStart };
  }

  /**
   * The *next* session describes which RDFa property/value was followed from
   * this source. The selection is controller-owned, not a transient DOM class.
   * Browsing breadcrumbs never discards it; only a replacement Shift-click can.
   */
  followedSource(sessionId: string): RecordStatement | null {
    const index = this.sessions.findIndex(session => session.id === sessionId);
    const next = index >= 0 ? this.sessions[index + 1] : undefined;
    if (!next?.via || next.via.subjectSessionId !== sessionId) return null;
    return {
      predicate: next.via.predicate,
      direction: next.via.direction,
      value: next.identity.value,
      termType: next.identity.termType,
      ...(next.identity.datatype ? { datatype: next.identity.datatype } : {}),
      ...(next.identity.lang ? { lang: next.identity.lang } : {}),
    };
  }

  /** Browse is the only caller allowed to replace session zero's inputs. */
  selectBrowseRecord(identity: RecordSessionIdentity): void {
    const first = this.sessions[0];
    if (first.identity.value === identity.value && first.identity.termType === identity.termType &&
        first.identity.datatype === identity.datatype && first.identity.lang === identity.lang &&
        first.identity.queryXml === identity.queryXml &&
        first.identity.bnodeQueryXml === identity.bnodeQueryXml) return;
    this.cancel(first.id);
    this.sessions[0] = { ...first, identity };
    this.disposeAfter(0);
  }

  appendPivot(identity: RecordSessionIdentity, via: RecordSessionEdge, after: number): RecordSessionDescriptor {
    if (!this.sessions[after] || this.sessions[after].id !== via.subjectSessionId) {
      throw new Error("The pivot source Record session is no longer available.");
    }
    this.disposeAfter(after);
    const next = { id: `record-${this.nextId++}`, identity, via };
    this.sessions.push(next);
    this.visibleStart = Math.max(0, this.sessions.length - 3);
    return next;
  }

  registerRequest(id: string, controller: AbortController): () => void {
    if (!this.sessions.some(s => s.id === id)) {
      controller.abort();
      return () => undefined;
    }
    let requests = this.pending.get(id);
    if (!requests) { requests = new Set(); this.pending.set(id, requests); }
    requests.add(controller);
    return () => {
      requests?.delete(controller);
      if (!requests?.size) this.pending.delete(id);
    };
  }

  /**
   * Breadcrumb navigation changes the viewport ONLY. It never destroys a
   * successor or cancels any of its Record work. Only appendPivot() may replace
   * the branch that follows a selected Record.
   */
  focusSession(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.sessions.length) {
      throw new RangeError("The requested Record breadcrumb is not in this session trail.");
    }
    this.visibleStart = Math.min(index, Math.max(0, this.sessions.length - 3));
  }

  slide(direction: -1 | 1): void {
    this.visibleStart = Math.min(Math.max(0, this.sessions.length - 3), Math.max(0, this.visibleStart + direction));
  }

  disposeAfter(index: number): void {
    if (index < 0) throw new Error("Cannot dispose the Browse Record session.");
    for (const session of this.sessions.slice(index + 1)) this.cancel(session.id);
    this.sessions = this.sessions.slice(0, index + 1);
    this.visibleStart = Math.min(this.visibleStart, Math.max(0, this.sessions.length - 3));
  }

  /** Shrink retains the *same* session-zero object; no re-fetch is implied. */
  shrink(): void {
    this.disposeAfter(0);
    this.visibleStart = 0;
  }

  private cancel(id: string): void {
    for (const request of this.pending.get(id) ?? []) request.abort();
    this.pending.delete(id);
  }
}
