import type { CompiledFctQuery } from "./fct-sparql-translator";
import { probeRuleAlignCapability, readSynsetRows, synsetCount, type SynsetProbeCache, type SynsetRead } from "./predicate-synset";

export class SynsetExecutionError extends Error {
  constructor(message:string, readonly status=502) { super(message); }
}
/** All mining and RuleAlign scores are obtained from the selected endpoint.
 * The read contract requires complete SPARQL JSON and propagates upstream errors. */
export async function executePredicateSynset(compiled:CompiledFctQuery, read:SynsetRead, signal:AbortSignal, cache?:SynsetProbeCache) {
  const plan=compiled.predicateSynset;
  if (!plan || !compiled.maxPredicateCandidates || !compiled.maxPredicateIncidenceRows) throw new SynsetExecutionError("Missing property synset plan.",400);
  const completeRead=async(query:string)=>{signal.throwIfAborted();const data=await read(query);signal.throwIfAborted();return data;};
  if (plan.algorithm==="rulealign") {
    const capability=await probeRuleAlignCapability(completeRead,signal,cache,true);
    if (!capability.rulealign) throw new SynsetExecutionError(`RuleAlign unavailable: ${capability.reason}`,422);
  }
  const budget=(await completeRead(plan.budgetQuery)).results?.bindings;
  if (budget?.length!==1) throw new SynsetExecutionError("Missing property synset budget statistics.");
  const candidates=synsetCount(budget[0].candidates,"candidate count"), pairs=synsetCount(budget[0].pairs,"pair count");
  if (candidates>compiled.maxPredicateCandidates || pairs>compiled.maxPredicateIncidenceRows)
    throw new SynsetExecutionError(`Property synset exceeds its configured budget (candidates: ${candidates} / ${compiled.maxPredicateCandidates}; argument pairs including carrier: ${pairs} / ${compiled.maxPredicateIncidenceRows}). Narrow the FCT population or increase the limits. No partial synset returned.`,422);
  if (candidates===0) return [];
  if (plan.ruleBudgetQuery) {
    const rules=(await completeRead(plan.ruleBudgetQuery)).results?.bindings;
    if (rules?.length!==1) throw new SynsetExecutionError("Missing RuleAlign support-group budget statistics.");
    const groups=synsetCount(rules[0].rules,"rule groups");
    if (groups>compiled.maxPredicateIncidenceRows)
      throw new SynsetExecutionError(`RuleAlign exceeds its configured rule support-group budget (${groups} / ${compiled.maxPredicateIncidenceRows}). No partial synset returned.`,422);
  }
  const data=await completeRead(compiled.query);
  if (!data.results?.bindings) throw new SynsetExecutionError("Missing property synset result bindings.");
  const rows=readSynsetRows(data.results.bindings,plan.carrier,plan.algorithm,compiled.maxPredicateCandidates,plan.confidenceN);
  if (rows.length>candidates) throw new SynsetExecutionError("Synset result exceeds the verified candidate population.");
  return rows.slice(compiled.offset,compiled.offset+compiled.limit);
}
