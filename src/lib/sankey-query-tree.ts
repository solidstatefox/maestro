/** Forward-only, query-tree-aware extension of the existing Recharts Sankey.
 * The first-degree coverage projection remains the authority for resource,
 * predicate, value, coverage percentage and initial flow weights. This module
 * only adds observed descendant FCT relationship branches after those values.
 * It does not traverse breadcrumbs, invent triples or mutate the live query.
 */
import type { FctQueryNode } from "./fct-query";
import type { SankeyCoverageGraph, SankeyCoverageLink, SankeyCoverageNode, SankeyTerm } from "./sankey-coverage";

export type SankeyQueryBranch = {
  id: string; iri: string; direction: "forward" | "reverse"; label: string;
  children: SankeyQueryBranch[];
};
export type SankeyTreeEdge = {
  /** Unique FCT property/property-of query node ID, not just the predicate. */
  branchId: string;
  parent: SankeyTerm;
  child: SankeyTerm;
};
export const SANKEY_MAX_DESCENDANT_NODES = 600;
export const SANKEY_MAX_TERMS_PER_BRANCH = 100;
export const SANKEY_MAX_DESCENDANT_REQUESTS = 48;

export const sankeyTermKey = (term: SankeyTerm) => JSON.stringify([
  term.type ?? "literal", term.value, term.datatype ?? "", term.lang ?? "",
]);
export const sankeyAxisKey = (axis: {iri:string;direction:string}) => `${axis.direction}|${axis.iri}`;

/** Includes every FCT relationship child, recursively; stops only at leaves.
 * Non-relationship constraints (class, value, text, view) do not become flows.
 * The FCT node ID is retained to distinguish repeated predicates in branches. */
export function sankeyBranchesAtFocus(nodes: readonly FctQueryNode[], label:(iri:string,direction:"forward"|"reverse")=>string):SankeyQueryBranch[] {
  return nodes.flatMap((node):SankeyQueryBranch[] => {
    if ((node.name !== "property" && node.name !== "property-of") || !node.attributes.iri) return [];
    const direction=node.name==="property-of"?"reverse" as const:"forward" as const;
    return [{id:node.id,iri:node.attributes.iri,direction,label:label(node.attributes.iri,direction),
      children:sankeyBranchesAtFocus(node.children,label)}];
  });
}

export function allSankeyBranches(roots:readonly SankeyQueryBranch[]):SankeyQueryBranch[] {
  return roots.flatMap(root=>[root,...allSankeyBranches(root.children)]);
}

/** All first-level term contexts from the original graph, with no new first-hop
 * query and no replacement of the already established resource coverage. */
export function sankeyInitialTerms(graph:SankeyCoverageGraph,roots:readonly SankeyQueryBranch[]):Map<string,SankeyTerm[]> {
  const result=new Map<string,Map<string,SankeyTerm>>();
  for(const root of roots) {
    if(!root.children.length)continue;
    const terms=new Map<string,SankeyTerm>();
    for(const node of graph.nodes)if(node.kind==="value" && node.term && node.axisKey===sankeyAxisKey(root)) {
      terms.set(sankeyTermKey(node.term),node.term);
    }
    if(terms.size)result.set(root.id,terms);
  }
  return new Map([...result].map(([key,terms])=>[key,[...terms.values()]]));
}

const concise=(text:string,max=44)=>text.length>max?`${text.slice(0,max-1)}…`:text;
const labelTerm=(term:SankeyTerm):string=>{
  if(term.type!=="uri")return concise(term.value);
  const component=term.value.split(/[#/]/).filter(Boolean).pop()||term.value;
  try{return concise(decodeURIComponent(component));}catch{return concise(component);}
};

/** Conserves existing flow: at each observed term, split its incoming weight
 * among only those outgoing query-tree relationships that have actual values.
 * Branch/path identity prevents cyclic RDF values from becoming Sankey cycles.
 * Unobserved descendants remain terminal, never fabricated links. */
export function extendSankeyThroughQueryTree(base:SankeyCoverageGraph,roots:readonly SankeyQueryBranch[],edges:readonly SankeyTreeEdge[]):SankeyCoverageGraph {
  if(!edges.length||!base.nodes.length)return base;
  const byParent=new Map<string,Map<string,SankeyTerm>>();
  for(const edge of edges){
    if(!edge.branchId||!edge.parent.value||!edge.child.value)continue;
    const key=`${edge.branchId}|${sankeyTermKey(edge.parent)}`;
    const terms=byParent.get(key)??new Map<string,SankeyTerm>();
    terms.set(sankeyTermKey(edge.child),edge.child);
    byParent.set(key,terms);
  }
  const nodes:SankeyCoverageNode[]=base.nodes.map(node=>({...node}));
  const links:SankeyCoverageLink[]=base.links.map(link=>({...link}));
  const weightByLink=new Map<string,number>();
  const predicateIndex=new Map<string,number>();
  const valueIndex=new Map<string,number>();
  const addLink=(source:number,target:number,value:number)=>{
    if(!(value>0))return;
    const key=`${source}|${target}`;
    weightByLink.set(key,(weightByLink.get(key)??0)+value);
  };
  type Context={source:number;branch:SankeyQueryBranch;term:SankeyTerm;weight:number};
  const queue:Context[]=[];
  // First-degree value nodes can be shared by several resources. Their
  // aggregated incoming flow is apportioned among repeated query branches.
  for(const [i,node] of nodes.entries()){
    if(node.kind!=="value"||!node.term||!node.axisKey)continue;
    const candidates=roots.filter(root=>root.children.length&&sankeyAxisKey(root)===node.axisKey);
    if(!candidates.length)continue;
    const incoming=base.links.filter(link=>link.target===i).reduce((sum,link)=>sum+link.value,0);
    for(const branch of candidates)queue.push({source:i,branch,term:node.term,weight:incoming/candidates.length});
  }
  let head=0;
  let descendantsTruncated=false;
  // Iterative BFS respects the finite query tree even for recursive RDF links.
  while(head<queue.length && nodes.length<SANKEY_MAX_DESCENDANT_NODES){
    const current=queue[head++];
    const matches=current.branch.children.flatMap(branch=>{
      const terms=[...(byParent.get(`${branch.id}|${sankeyTermKey(current.term)}`)?.values()??[])];
      return terms.length?[{branch,terms}]:[];
    });
    if(!matches.length)continue;
    const branchWeight=current.weight/matches.length;
    for(const {branch,terms} of matches){
      // Reserve the whole branch before adding its incoming flow. Otherwise
      // hitting the display-node cap could create a dangling predicate link.
      const required=(predicateIndex.has(branch.id)?0:1)+terms.filter(term=>
        !valueIndex.has(`${branch.id}|${sankeyTermKey(term)}`)).length;
      if(nodes.length+required>SANKEY_MAX_DESCENDANT_NODES){descendantsTruncated=true;continue;}
      let predicate=predicateIndex.get(branch.id);
      if(predicate===undefined){
        predicate=nodes.length;
        nodes.push({name:concise(branch.label),kind:"predicate",uri:branch.iri,
          tooltip:`${branch.direction==="reverse"?"Incoming role":"Outgoing property"}: ${branch.iri}`});
        predicateIndex.set(branch.id,predicate);
      }
      addLink(current.source,predicate,branchWeight);
      for(const term of terms){
        if(nodes.length>=SANKEY_MAX_DESCENDANT_NODES)break;
        const key=`${branch.id}|${sankeyTermKey(term)}`;
        let target=valueIndex.get(key);
        if(target===undefined){
          target=nodes.length;
          nodes.push({name:labelTerm(term),kind:"value",uri:term.type==="uri"?term.value:undefined,
            term,axisKey:sankeyAxisKey(branch),
            tooltip:`${branch.label}: ${term.value}`});
          valueIndex.set(key,target);
        }
        const value=branchWeight/terms.length;
        addLink(predicate,target,value);
        if(branch.children.length)queue.push({source:target,branch,term,weight:value});
      }
    }
  }
  if(head<queue.length)descendantsTruncated=true;
  for(const [key,value] of weightByLink){
    const [source,target]=key.split("|").map(Number);
    links.push({source,target,value});
  }
  return {...base,nodes,links,descendantsTruncated};
}
