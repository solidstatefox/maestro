"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

export type GraphTreeItem = { uri: string };
type TreeNode<T extends GraphTreeItem> = { prefix: string; item?: T; children: TreeNode<T>[] };

/** A URI-prefix trie, compressed between branches and existing graph URIs.
 * A graph URI that prefixes another graph remains a selectable leaf and a parent.
 * This is a presentation-only hierarchy; RDF named graph identifiers are unmodified.
 */
export function buildGraphUriTree<T extends GraphTreeItem>(graphs: readonly T[]): TreeNode<T>[] {
  const root: TreeNode<T> = { prefix: "", children: [] };
  for (const item of graphs) {
    const value = item.uri;
    const origin = value.match(/^[a-z][a-z0-9+.-]*:\/\/[^/#?]+/i)?.[0] ?? value.split(/[\/#]/)[0];
    const prefixes = [origin];
    const trail = value.slice(origin.length);
    const pattern = /[\/#][^\/#]*/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(trail))) {
      const prefix = value.slice(0, origin.length + match.index + match[0].length);
      if (prefix && prefix !== prefixes[prefixes.length - 1]) prefixes.push(prefix);
    }
    if (prefixes[prefixes.length - 1] !== value) prefixes.push(value);
    let node = root;
    for (const prefix of prefixes) {
      let child = node.children.find((entry) => entry.prefix === prefix);
      if (!child) { child = { prefix, children: [] }; node.children.push(child); }
      node = child;
    }
    node.item = item;
  }
  const compress = (node: TreeNode<T>): TreeNode<T> => {
    node.children = node.children.map(compress).sort((a, b) => a.prefix.localeCompare(b.prefix));
    while (!node.item && node.children.length === 1) node = node.children[0];
    return node;
  };
  return root.children.map(compress).sort((a, b) => a.prefix.localeCompare(b.prefix));
}

export function flattenGraphUriTree<T extends GraphTreeItem>(nodes: readonly TreeNode<T>[]): T[] {
  return nodes.flatMap((node) => [...(node.item ? [node.item] : []), ...flattenGraphUriTree(node.children)]);
}

/** The same Collapsible row design used by the Categories tree.
 * Prefix nodes without an actual named graph are folders, not selectable graphs.
 */
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FACET_ITEM_GAP_CLASS } from "@/canvas/left/facet-layout";
import { shortenCount } from "@/lib/utils";

export function graphTreeParentKeys<T extends GraphTreeItem>(nodes: readonly TreeNode<T>[]): string[] {
  return nodes.flatMap((node) => node.children.length > 0
    ? [node.prefix, ...graphTreeParentKeys(node.children)]
    : []);
}

type GraphDisplayItem = GraphTreeItem & { label?: string; count?: number };

function GraphTreeBranch<T extends GraphDisplayItem>({ node, depth, expanded, setExpanded, selectedUri, onSelect }: {
  node: TreeNode<T>;
  depth: number;
  expanded: Set<string>;
  setExpanded: (update: (current: Set<string>) => Set<string>) => void;
  selectedUri: string;
  onSelect: (uri: string) => void;
}) {
  const isOpen = expanded.has(node.prefix);
  const hasChildren = node.children.length > 0;
  const label = node.item?.label || node.prefix;
  return <Collapsible open={isOpen} onOpenChange={(open) => setExpanded((current) => {
    const next = new Set(current);
    if (open) next.add(node.prefix); else next.delete(node.prefix);
    return next;
  })} className="min-w-0">
    <div className="flex min-w-0 items-center gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50"
      style={depth ? { paddingLeft: `${8 + depth * 14}px` } : undefined}>
      {node.item && node.item.uri === selectedUri
        ? <span className="size-4 shrink-0" aria-hidden="true" />
        : node.item
        ? <input type="radio" name="maestro-query-graph-personal" checked={selectedUri === node.item.uri}
            onChange={() => onSelect(node.item!.uri)} aria-label={`Bind graph ${label}`}
            className="size-4 shrink-0 accent-current" />
        : <span className="size-4 shrink-0" aria-hidden="true" />}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {node.item
          ? <Tooltip><TooltipTrigger render={<button type="button" className="min-w-0 cursor-pointer break-all text-left underline-offset-2 hover:underline"
              onClick={() => onSelect(node.item!.uri)}>{label}</button>} /><TooltipContent>{node.item.uri}</TooltipContent></Tooltip>
          : <span className="min-w-0 break-all">{label}</span>}
        {hasChildren && <CollapsibleTrigger aria-label={`${isOpen ? "Collapse" : "Expand"} ${label}`}
          className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
          {isOpen ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
        </CollapsibleTrigger>}
      </div>
      {node.item && (node.item.count ?? 0) > 0 && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{shortenCount(node.item.count ?? 0)}</span>}
    </div>
    {hasChildren && <CollapsibleContent className={`mt-0.5 ${FACET_ITEM_GAP_CLASS}`}>
      {node.children.map((child) => <GraphTreeBranch key={child.prefix} node={child} depth={depth + 1}
        expanded={expanded} setExpanded={setExpanded} selectedUri={selectedUri} onSelect={onSelect} />)}
    </CollapsibleContent>}
  </Collapsible>;
}

export function GraphUriTree<T extends GraphDisplayItem>({ nodes, expanded, setExpanded, selectedUri, onSelect }: {
  nodes: readonly TreeNode<T>[];
  expanded: Set<string>;
  setExpanded: (update: (current: Set<string>) => Set<string>) => void;
  selectedUri: string;
  onSelect: (uri: string) => void;
}) {
  return <div className={FACET_ITEM_GAP_CLASS}>
    {nodes.map((node) => <GraphTreeBranch key={node.prefix} node={node} depth={0}
      expanded={expanded} setExpanded={setExpanded} selectedUri={selectedUri} onSelect={onSelect} />)}
  </div>;
}
