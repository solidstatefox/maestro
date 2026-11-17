import type { FctQueryNode, FctQueryTree } from "./fct-query";
import { fctQueryTreeApi } from "./fct-query-api";
import { FCT_VIEW_TYPES } from "./fct-view-types";

const validUri = (uri: string) => /^[A-Za-z][A-Za-z\d+.-]*:[^\s<>"{}|^`\\]+$/.test(uri);

/** Detached FCT result-set query for the mindmap's two input resources.
 * Multiple root URI <value>s are a bounded OR (unlike property value AND).
 * No raw SPARQL is embedded in the shareable query. */
export function overviewInputResourcesQuery(tree: FctQueryTree, resources: readonly string[]): FctQueryTree | null {
  const uris = [...new Set(resources)].filter(validUri);
  if (uris.length !== 2) return null;
  const base = fctQueryTreeApi.getDataTree(tree);
  const findView = (nodes: FctQueryNode[]): FctQueryNode | undefined => {
    for (const node of nodes) {if (node.name === "view") return node;const found=findView(node.children);if(found)return found;}
    return undefined;
  };
  const existing = findView(base.children);
  const view: FctQueryNode = existing ? {...existing,id:"query-view",attributes:{...existing.attributes,type:FCT_VIEW_TYPES.LIST,offset:"0"},children:[]}
    : {id:"query-view",name:"view",attributes:{type:FCT_VIEW_TYPES.LIST,limit:"30",offset:"0"},children:[]};
  return {...base,attributes:{...base.attributes,ctr:String(Math.max(10,Number(base.attributes.ctr)||10))},children:[...uris.map((uri,index):FctQueryNode=>({id:`resource-set-${index+1}`,name:"value",attributes:{datatype:"uri"},text:uri,children:[]})),view]};
}
