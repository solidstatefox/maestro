import type { FctQueryNode, FctQueryTree } from "./fct-query";
import { fctQueryTreeApi } from "./fct-query-api";
import { ensureFctQueryIds } from "./fct-node-identity";
import { overviewInputResourcesQuery } from "./overview-resource-query";
import type { ConnectionPath } from "./overview-connection-path";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const absolute = (uri: string): boolean => /^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(uri);
export type PathQuestion = {tree:FctQueryTree;pattern:"class"|"property"|"role"|"pair";description:string};

/** Turn a verified two-hop path into an FCT question matching BOTH inputs.
 * Both endpoints must independently possess the SAME edge to the common node.
 * Mixed paths aren't a single conjunctive FCT facet; those fall back to the
 * precisely bounded two-resource query and are labeled as such. */
export function overviewPathQuestion(tree: FctQueryTree, path:ConnectionPath):PathQuestion|null {
  const nodes=path.nodes.map(node=>node.uri);
  if(nodes.length<2 || nodes.some(uri=>!absolute(uri))) return null;
  const source=nodes[0],target=nodes[nodes.length-1];
  const pair=overviewInputResourcesQuery(tree,[source,target]);
  if(!pair) return null;
  const fallback:PathQuestion={tree:pair,pattern:"pair",description:"Both endpoints (the path uses different relationships, so there is no single shared FCT facet)."};
  if(nodes.length!==3) return fallback;
  const via=nodes[1];
  // Edge discovery may return several verified predicates for each hop.
  // Select a common predicate with both statements oriented consistently
  // relative to their *outer* resources; never fall back merely because
  // more than one edge was reported for the path.
  const left=path.edges.filter(e=>e.from===source && e.to===via && absolute(e.predicate));
  const right=path.edges.filter(e=>e.from===via && e.to===target && absolute(e.predicate));
  const match=left.flatMap(a=>right.filter(b=>a.predicate===b.predicate && a.direction!==b.direction).map(b=>({a,b})))[0];
  if(!match) return fallback;
  const {a,b}=match;
  const predicate=a.predicate;
  const bothForward=a.direction==="forward" && b.direction==="reverse";
  const bothReverse=a.direction==="reverse" && b.direction==="forward";
  const base=fctQueryTreeApi.getDataTree(tree);
  const originalView=pair.children.find(node=>node.name==="view");
  if(!originalView) return null;
  const view:FctQueryNode={...originalView,id:"question-view",children:[],attributes:{...originalView.attributes,offset:"0"}};
  let question:FctQueryNode;
  let pattern:PathQuestion["pattern"];
  if(bothForward && predicate===RDF_TYPE) {
    pattern="class";
    question={id:"question-class",name:"class",attributes:{iri:via},children:[]};
  } else {
    pattern=bothForward?"property":"role";
    question={id:"question-relationship",name:bothForward?"property":"property-of",attributes:{iri:predicate},children:[
      {id:"question-value",name:"value",attributes:{datatype:"uri"},text:via,children:[]},
    ]};
  }
  const raw:FctQueryTree={...base,children:[question,view]};
  const normalized=ensureFctQueryIds(raw) as FctQueryTree;
  return {tree:normalized,pattern,description:`Resources sharing ${predicate} with ${via}`};
}
