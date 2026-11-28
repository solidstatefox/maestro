import type { FctQueryNode, FctQueryTree } from "./fct-query";
import { cloneFctQueryTree } from "./fct-query-clone";
import { nextFctQueryId } from "./fct-node-identity";
import { serializeFctQuery } from "./fct-query-serialize";
import { FCT_VIEW_TYPES, MAX_PREDICATE_ANALYSIS_CANDIDATES, MAX_PREDICATE_ANALYSIS_INCIDENCE_ROWS, predicateSynsetAlgorithm, type PredicateSynsetAlgorithm } from "./fct-view-types";

export const SYNSET_STORAGE_URI = "urn:maestro:properties-synset";
export const SYNSET_SETTINGS = {timeoutMs:120000,maxCandidates:500,maxIncidenceRows:50000,maxRuleLength:2,minSupport:2,minHeadCoverage:0.005,minConfidence:0.05,confidenceN:15};
export type SynsetSettings = typeof SYNSET_SETTINGS;
export function validSynsetSetting(key:keyof SynsetSettings, value:number):boolean {
  if (!Number.isFinite(value)) return false;
  if (key === "minHeadCoverage" || key === "minConfidence") return value>=0 && value<=1;
  if (!Number.isSafeInteger(value)) return false;
  switch(key) {
    case "timeoutMs": return value>=1000 && value<=2147483647;
    case "maxCandidates": return value>=1 && value<=MAX_PREDICATE_ANALYSIS_CANDIDATES;
    case "maxIncidenceRows": return value>=1 && value<=MAX_PREDICATE_ANALYSIS_INCIDENCE_ROWS;
    case "maxRuleLength": return value===1 || value===2;
    case "minSupport": return value>=1 && value<=500000;
    case "confidenceN": return value>=1 && value<=1000;
  }
}
export function synsetCarrier(tree:FctQueryTree):{carrier:FctQueryNode; view:FctQueryNode}|null {
  const views:Array<{parent:FctQueryTree|FctQueryNode;view:FctQueryNode}>=[];
  const visit=(parent:FctQueryTree|FctQueryNode)=>{
    for(const node of parent.children) {
      if(node.name==="view") views.push({parent,view:node});
      else visit(node);
    }
  };
  visit(tree);
  if(views.length!==1) return null;
  const {parent,view}=views[0];
  if((parent.name!=="property" && parent.name!=="property-of") || !("id" in parent) || !parent.attributes.iri || parent.attributes.derive || view.attributes.kindFilter || (view.attributes.kind && view.attributes.kind!=="all")) return null;
  return {carrier:parent,view};
}
/** Select a ranked outgoing predicate relative to the current focus, not the
 * incoming breadcrumb relationship. Never reuse or mutate a constrained node. */
export function synsetTreeForRankedProperty(tree:FctQueryTree,iri:string):FctQueryTree|null {
  if(!iri) return null;
  const copy=cloneFctQueryTree(tree,"data");
  const views:Array<{parent:FctQueryTree|FctQueryNode;view:FctQueryNode}>=[];
  const walk=(parent:FctQueryTree|FctQueryNode)=>{for(const node of parent.children) {
    if(node.name==="view") views.push({parent,view:node});else walk(node);
  }};
  walk(copy);
  if(views.length!==1) return null;
  const {parent,view}=views[0];
  if(view.attributes.kindFilter || (view.attributes.kind && view.attributes.kind!=="all")) return null;
  // A fromView reference depends on the old carrier population. Do not move
  // that population silently; preserve the original scope or decline launch.
  const references=(node:FctQueryTree|FctQueryNode):boolean=>node.attributes.fromView===view.id || node.children.some(references);
  if(references(copy)) return null;
  const allocated=nextFctQueryId(copy);
  copy.attributes.ctr=allocated.ctr;
  parent.children=parent.children.map(node=>node===view?{id:allocated.id,name:"property",attributes:{iri},children:[view]}:node);
  return copy;
}
export function buildSynsetQuery(tree:FctQueryTree,algorithm:PredicateSynsetAlgorithm,settings:SynsetSettings):string {
  predicateSynsetAlgorithm(algorithm);
  for(const key of Object.keys(SYNSET_SETTINGS) as (keyof SynsetSettings)[]) if(!validSynsetSetting(key,settings[key])) throw new Error(`Invalid property synset setting: ${key}.`);
  const copy=cloneFctQueryTree(tree,"data");
  const found=synsetCarrier(copy);
  if(!found) throw new Error("A concrete relationship view carrier is required.");
  found.view.attributes={type:FCT_VIEW_TYPES.PROPERTIES_SYNSET,algorithm,limit:String(settings.maxCandidates),offset:"0",timeout:String(settings.timeoutMs),
    "max-candidates":String(settings.maxCandidates),"max-incidence-rows":String(settings.maxIncidenceRows),
    "max-rule-length":String(settings.maxRuleLength),"min-support":String(settings.minSupport),
    "min-head-coverage":String(settings.minHeadCoverage),"min-confidence":String(settings.minConfidence),"confidence-n":String(settings.confidenceN)};
  return serializeFctQuery(copy);
}
