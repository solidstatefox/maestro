"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { useState } from "react";
import { Regex, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useFctQuery, type FctQueryNode, type FctQueryTree } from "@/lib/fct-query";

/** Named regex definitions belong to the same property node as other <value>s.
 * Unchecked entries are retained with enabled="false" and ignored by both
 * FCT and distinct-count translators. Multiple checked regexes are ANDed,
 * consistent with Maestro's existing multiple bound-value semantics. */
function updateRegex(tree: FctQueryTree, relationshipId: string,
  action: { type: "add"; name: string; pattern: string } | { type: "toggle"; id: string; enabled: boolean }): FctQueryTree {
  let modified = false;
  const update = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map(node => {
    if (node.id !== relationshipId) return { ...node, children: update(node.children) };
    if (node.name !== "property" && node.name !== "property-of") return node;
    modified = true;
    if (action.type === "add") {
      const nextValue: FctQueryNode = {
        id: `named-regex-${encodeURIComponent(action.name)}-${Date.now()}`, name: "value",
        attributes: { name: action.name, op: "regex", datatype: "string", enabled: "false" },
        text: action.pattern, children: [],
      };
      return { ...node, children: [...node.children, nextValue] };
    }
    return { ...node, children: node.children.map(value => value.id === action.id
      ? { ...value, attributes: { ...value.attributes, enabled: action.enabled ? "true" : "false" } }
      : value) };
  });
  const children = update(tree.children);
  return modified ? { ...tree, children } : tree;
}

/** With no matching selected relationship, insert one beside the active
 * <view> before adding the definition. The live <view> never moves. */
function addRegexToUnboundFacet(tree: FctQueryTree, propertyUri: string,
  action: {type:"add"; name:string; pattern:string}): FctQueryTree {
  let inserted=false;
  const visit=(nodes:FctQueryNode[]):FctQueryNode[] => {
    if (nodes.some(node=>node.name==="view")) {
      inserted=true;
      const source=nodes.find(node=>node.name==="property" && node.attributes.iri===propertyUri);
      if (source) return updateRegex({...tree,children:nodes},source.id,action).children;
      const created:FctQueryNode={id:`regex-facet-${encodeURIComponent(propertyUri)}`,
        name:"property",attributes:{iri:propertyUri},children:[]};
      return [...updateRegex({...tree,children:[...nodes,created]},created.id,action).children];
    }
    return nodes.map(node=>({...node,children:visit(node.children)}));
  };
  const children=visit(tree.children);
  if (!inserted) throw new Error("No active FCT view scope is available for the regex filter.");
  return {...tree,children};
}
export function NamedRegexCreateButton({ relationship, propertyUri }: { relationship?: FctQueryNode; propertyUri: string }) {
  const { tree, replaceTree } = useFctQuery();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [error, setError] = useState("");
  const apply = () => {
    if (!name.trim() || !pattern.trim()) { setError("Enter a name and a regular expression."); return; }
    if (pattern.length > 2000 || name.length > 120) { setError("Regex patterns must be under 2001 characters and names under 121."); return; }
    try { new RegExp(pattern); } catch (e) { setError(e instanceof Error ? e.message : "Invalid regex"); return; }
    replaceTree(relationship
      ? updateRegex(tree, relationship.id, {type:"add",name:name.trim(),pattern})
      : addRegexToUnboundFacet(tree,propertyUri,{type:"add",name:name.trim(),pattern}));
    setOpen(false); setError(""); setName(""); setPattern("");
  };
  return <>
    <Tooltip><TooltipTrigger render={<button type="button" onClick={() => setOpen(true)}
      aria-label="Add named regular-expression filter"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"><Regex className="size-4" /></button>} />
      <TooltipContent>Add named regex filter</TooltipContent></Tooltip>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-label="Named regular expression" className="w-full max-w-lg space-y-3 p-4">
        <header className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Named regex filter</h2>
          <button type="button" aria-label="Cancel regex filter" onClick={() => setOpen(false)}><X className="size-4" /></button></header>
        <label className="block space-y-1 text-sm">Name<input className="w-full rounded border bg-background px-2 py-1.5" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="e.g. University domains" /></label>
        <label className="block space-y-1 text-sm">Regex pattern<textarea className="w-full rounded border bg-background px-2 py-1.5 font-mono text-xs" value={pattern} onChange={e => setPattern(e.target.value)} rows={3} maxLength={2000} placeholder="^[^@]+@example\.org$" /></label>
        <p className="text-xs text-muted-foreground">New filters are saved unchecked. Check one in the facet list to apply it; multiple checked patterns use AND.</p>
        {error && <ErrorDetails prefix="Facet regex" error={error} />}
        <div className="flex justify-end gap-2"><button className="rounded border px-3 py-1.5 text-sm hover:bg-accent" onClick={() => setOpen(false)}>Cancel</button>
          <button className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={apply}>Apply</button></div>
      </DialogContent>
    </Dialog>
  </>;
}
export function NamedRegexList({ relationship }: { relationship: FctQueryNode }) {
  const { tree, replaceTree } = useFctQuery();
  const regexes = relationship.children.filter(node => node.name === "value" && node.attributes.op === "regex" && node.attributes.name);
  if (!regexes.length) return null;
  return <div className="mb-2 space-y-1 border-b px-1 pb-2" aria-label="Saved regex filters">
    {regexes.map(node => <label key={node.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent/50">
      <input type="checkbox" checked={node.attributes.enabled !== "false"}
        onChange={event => replaceTree(updateRegex(tree, relationship.id, { type: "toggle", id: node.id, enabled: event.target.checked }))}
        aria-label={`Apply regex ${node.attributes.name}`} />
      <Tooltip><TooltipTrigger render={<span className="truncate" title={node.attributes.name}>{node.attributes.name}</span>} />
        <TooltipContent><code className="break-all">{node.text}</code></TooltipContent></Tooltip>
    </label>)}
  </div>;
}
