"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { sankey, sankeyCenter, sankeyJustify, sankeyLeft, sankeyLinkHorizontal, sankeyRight } from "d3-sankey";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { SankeyCoverageGraph, SankeyCoverageNode } from "@/lib/sankey-coverage";
import { traceSankeyStreams } from "@/lib/sankey-stream-focus";
import { ErrorDetails } from "@/components/ui/error-details";

/** Only rendering and experimentation live here: RDF/FCT projection, coverage
 * denominators, paging, navigation and provider approval are shared with the
 * original Recharts Analysis provider. No mutable RDF or FCT query state. */
const palettes: Record<string,Record<SankeyCoverageNode["kind"], string>> = {
  "Tableau": {scope:"#64748b", resource:"#2563eb",predicate:"#0d9488",value:"#a78bfa"},
  "Vivid": {scope:"#df1e36",resource:"#e69b17",predicate:"#16a34a",value:"#7c3aed"},
  "Pastel": {scope:"#94a3b8",resource:"#93c5fd",predicate:"#99f6e4",value:"#ddd6fe"},
  "Monochrome": {scope:"#475569",resource:"#64748b",predicate:"#94a3b8",value:"#cbd5e1"},
};
type Align = "left" | "right" | "center" | "justify";
type LinkColor = "source" | "target" | "source-target" | "stage" | "neutral";
type NodeSort = "auto" | "label" | "value";
type Node = { id: string; name: string; kind: SankeyCoverageNode["kind"]; uri?: string; tooltip?: string;
  x0: number; x1: number; y0: number; y1: number; value?: number; index?: number };
type Link = { source: Node; target: Node; value: number; width: number; y0: number; y1: number; index?: number };
const aligners = {left:sankeyLeft,right:sankeyRight,center:sankeyCenter,justify:sankeyJustify};
const clamp = (n:number,min:number,max:number) => Math.min(max,Math.max(min,n));
const format = (n:number) => `${n.toLocaleString(undefined,{maximumFractionDigits:2})} percentage points`;

export function D3SankeyDiagram({data,minWidth,onOpenResource}:{data:SankeyCoverageGraph;minWidth:number;onOpenResource:(uri:string)=>void}) {
  const gradientPrefix = useId().replace(/[^a-zA-Z0-9_-]/g,"-");
  const [align,setAlign] = useState<Align>("justify");
  const [linkColor,setLinkColor] = useState<LinkColor>("source-target");
  const [nodeSort,setNodeSort] = useState<NodeSort>("auto");
  const [nodeWidth,setNodeWidth] = useState(16);
  const [nodePadding,setNodePadding] = useState(12);
  const [iterations,setIterations] = useState(32);
  const [linkOpacity,setLinkOpacity] = useState(0.55);
  const [nodeOpacity,setNodeOpacity] = useState(0.88);
  const [showLabels,setShowLabels] = useState(true);
  const [paletteName,setPaletteName] = useState("Tableau");
  const [multicolorColumns,setMulticolorColumns] = useState(false);
  const [selectedNode,setSelectedNode] = useState<string|null>(null);
  useEffect(()=>setSelectedNode(null),[data]);
  const [nodeStrokeWidth,setNodeStrokeWidth] = useState(0.5);
  const [labelPadding,setLabelPadding] = useState(6);
  const [blendMode,setBlendMode] = useState<"normal"|"multiply"|"screen">("normal");
  const [canvasHeight,setCanvasHeight] = useState(0);
  const [widthMultiplier,setWidthMultiplier] = useState(100);
  const palette=palettes[paletteName];
  const [zoom,setZoom] = useState(1);
  const [offset,setOffset] = useState({x:0,y:0});
  const dragging = useRef<{x:number;y:number;offsetX:number;offsetY:number}|null>(null);
  const width = Math.round(Math.max(960,minWidth)*widthMultiplier/100);
  const height = canvasHeight || Math.max(560,Math.min(980,data.nodes.length*17+250));
  const graph = useMemo(()=> {
    const validLinks=data.links.filter(l=>Number.isInteger(l.source)&&Number.isInteger(l.target)&&l.source>=0&&l.target>=0&&
      l.source<data.nodes.length&&l.target<data.nodes.length&&Number.isFinite(l.value)&&l.value>0);
    try {
      const nodes=data.nodes.map((n,index)=>({...n,id:String(index)}));
      const links=validLinks.map(l=>({source:String(l.source),target:String(l.target),value:l.value}));
      const builder=sankey<Node,Link>()
        .nodeId(n=>n.id).nodeAlign(aligners[align]).nodeWidth(nodeWidth).nodePadding(nodePadding)
        .iterations(iterations).extent([[18,20],[width-200,height-20]]);
      if(nodeSort!=="auto") builder.nodeSort(nodeSort==="label"
        ? (a,b)=>a.name.localeCompare(b.name)
        : (a,b)=>(b.value??0)-(a.value??0));
      const result=builder({nodes,links} as never);
      return {nodes:result.nodes as Node[],links:result.links as Link[],error:""};
    } catch (cause) {
      // D3 Sankey requires an acyclic projection. A failed layout must never
      // fabricate links or replace the original working Recharts provider.
      return {nodes:[] as Node[],links:[] as Link[],error:cause instanceof Error?cause.message:"Layout unavailable"};
    }
  },[data,align,nodeSort,nodeWidth,nodePadding,iterations,width,height]);
  // A stage uses one color by default. In multicolor mode each row in the
  // same column receives a distinct hue, without changing the graph weights.
  const nodeColors=useMemo(()=>{
    const colors=new Map<string,string>();
    if(!multicolorColumns){for(const node of graph.nodes)colors.set(node.id,palette[node.kind]);return colors;}
    const columns=new Map<number,Node[]>();
    for(const node of graph.nodes){const key=Math.round(node.x0);
      const column=columns.get(key)??[];column.push(node);columns.set(key,column);}
    for(const [column,rows] of columns){
      rows.sort((a,b)=>a.y0-b.y0 || a.id.localeCompare(b.id));
      rows.forEach((node,index)=>{
        const hue=((index*137.508 + column*0.63 + (paletteName==="Vivid"?30:paletteName==="Pastel"?180:0))%360+360)%360;
        const light=paletteName==="Pastel"?73:paletteName==="Monochrome"?48:56;
        const saturation=paletteName==="Monochrome"?12:paletteName==="Pastel"?64:70;
        colors.set(node.id,`hsl(${hue.toFixed(2)} ${saturation}% ${light}%)`);
      });
    }
    return colors;
  },[graph.nodes,multicolorColumns,palette,paletteName]);
  const nodeColor=(node:Node)=>nodeColors.get(node.id)??palette[node.kind];
  const streamFocus=useMemo(()=>selectedNode!==null && multicolorColumns
    ?traceSankeyStreams(graph.links.map(link=>({source:link.source.id,target:link.target.id})),selectedNode)
    :null,[graph.links,selectedNode,multicolorColumns]);
  const path = sankeyLinkHorizontal<Node,Link>();
  const gradientId = (index:number) => `${gradientPrefix}-ribbon-${index}`;
  const edgeStroke=(l:Link,i:number) => linkColor==="source-target"?`url(#${gradientId(i)})`
    :linkColor==="source"?nodeColor(l.source)
    :linkColor==="target" || linkColor==="stage"?nodeColor(l.target)
    :"var(--muted-foreground)";
  const inputClass="rounded-md border bg-background px-2 py-1 text-xs text-foreground";
  const reset=()=>{setZoom(1);setOffset({x:0,y:0});};
  const pointerDown=(event:PointerEvent<SVGSVGElement>)=>{
    if(event.button!==0 || (event.target as Element).closest('[data-d3-sankey-node]')) return;
    dragging.current={x:event.clientX,y:event.clientY,offsetX:offset.x,offsetY:offset.y};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove=(event:PointerEvent<SVGSVGElement>)=>{
    if(!dragging.current)return;
    const start=dragging.current;
    setOffset({x:start.offsetX+(event.clientX-start.x),y:start.offsetY+(event.clientY-start.y)});
  };
  return <div className="flex w-full min-w-0 flex-col gap-3" data-d3-sankey-renderer="true">
    <div role="group" aria-label="D3 Sankey layout controls" className="flex w-full flex-wrap items-end gap-3 rounded-md border bg-muted/20 px-3 py-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Node alignment
        <select className={inputClass} value={align} onChange={e=>setAlign(e.target.value as Align)}>
          <option value="justify">Justify</option><option value="left">Left</option><option value="right">Right</option><option value="center">Center</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Link color
        <select className={inputClass} value={linkColor} onChange={e=>setLinkColor(e.target.value as LinkColor)}>
          <option value="source-target">Source → target gradient</option><option value="source">Source</option><option value="target">Target</option><option value="stage">Stage</option><option value="neutral">Neutral</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={multicolorColumns} onChange={event=>setMulticolorColumns(event.target.checked)}/>
        Multicolor columns
      </label>
      {multicolorColumns && selectedNode!==null && <button type="button" className={inputClass}
        onClick={()=>setSelectedNode(null)}>Show all streams</button>}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Colors by node stage
        <select className={inputClass} value={paletteName} onChange={e=>setPaletteName(e.target.value)}>
          {Object.keys(palettes).map(name=><option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Node order
        <select className={inputClass} value={nodeSort} onChange={e=>setNodeSort(e.target.value as NodeSort)}>
          <option value="auto">Automatic</option><option value="label">Alphabetical</option><option value="value">Value</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Node width: {nodeWidth}px
        <input type="range" min="4" max="40" step="2" value={nodeWidth} onChange={e=>setNodeWidth(Number(e.target.value))}/>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Node padding: {nodePadding}px
        <input type="range" min="0" max="40" step="2" value={nodePadding} onChange={e=>setNodePadding(Number(e.target.value))}/>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Label padding: {labelPadding}px
        <input type="range" min="0" max="24" step="2" value={labelPadding} onChange={e=>setLabelPadding(Number(e.target.value))}/>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Node border: {nodeStrokeWidth}px
        <input type="range" min="0" max="3" step="0.5" value={nodeStrokeWidth} onChange={e=>setNodeStrokeWidth(Number(e.target.value))}/>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Iterations: {iterations}
        <input type="range" min="0" max="64" step="4" value={iterations} onChange={e=>setIterations(Number(e.target.value))}/>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Ribbons: {Math.round(linkOpacity*100)}%
        <input type="range" min="0.1" max="1" step="0.05" value={linkOpacity} onChange={e=>setLinkOpacity(Number(e.target.value))}/>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Nodes: {Math.round(nodeOpacity*100)}%
        <input type="range" min="0.2" max="1" step="0.05" value={nodeOpacity} onChange={e=>setNodeOpacity(Number(e.target.value))}/>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Ribbon blend mode
        <select className={inputClass} value={blendMode} onChange={e=>setBlendMode(e.target.value as typeof blendMode)}>
          <option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Chart width: {widthMultiplier}%
        <input type="range" min="100" max="200" step="10" value={widthMultiplier} onChange={e=>setWidthMultiplier(Number(e.target.value))}/>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Chart height
        <select className={inputClass} value={canvasHeight} onChange={e=>setCanvasHeight(Number(e.target.value))}>
          <option value={0}>Automatic</option><option value={560}>560px</option><option value={760}>760px</option><option value={960}>960px</option><option value={1200}>1200px</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showLabels} onChange={e=>setShowLabels(e.target.checked)}/>Labels</label>
      <div className="flex items-center gap-1" role="group" aria-label="D3 Sankey zoom controls">
        <button type="button" className={inputClass} aria-label="Zoom out" onClick={()=>setZoom(v=>clamp(v/1.25,0.3,4))}><Minus className="size-4"/></button>
        <span className="min-w-12 text-center text-xs tabular-nums">{Math.round(zoom*100)}%</span>
        <button type="button" className={inputClass} aria-label="Zoom in" onClick={()=>setZoom(v=>clamp(v*1.25,0.3,4))}><Plus className="size-4"/></button>
        <button type="button" className={inputClass} aria-label="Reset zoom and pan" onClick={reset}><RotateCcw className="size-4"/></button>
      </div>
    </div>
    {graph.error ? <ErrorDetails prefix="D3 Sankey layout" error={`${graph.error}. You can use the original Sankey Analysis provider.`} />
    : <div className="w-full overflow-auto rounded-md border bg-card" role="img" aria-label="Interactive D3 Sankey of FCT resource coverage and descendant relationships">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{minWidth:width}} className="touch-pan-y" onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerUp={()=>{dragging.current=null;}} onPointerCancel={()=>{dragging.current=null;}}>
        <defs>{linkColor==="source-target" && graph.links.map((link,i)=><linearGradient key={gradientId(i)} id={gradientId(i)} gradientUnits="userSpaceOnUse" x1={link.source.x1} x2={link.target.x0} y1={link.y0} y2={link.y1}>
          <stop offset="0%" stopColor={nodeColor(link.source)}/><stop offset="100%" stopColor={nodeColor(link.target)}/>
        </linearGradient>)}</defs>
        <g transform={`translate(${offset.x},${offset.y}) scale(${zoom})`}>
          <g fill="none" style={{mixBlendMode:blendMode}}>{graph.links.map((link,i)=><path key={`link-${i}`} d={path(link)??""} stroke={edgeStroke(link,i)} strokeWidth={Math.max(1,link.width)} strokeOpacity={streamFocus && !streamFocus.links.has(i) ? Math.min(0.04,linkOpacity*0.08) : linkOpacity}>
            <title>{`${link.source.name} → ${link.target.name}: ${format(link.value)}`}</title>
          </path>)}</g>
          <g>{graph.nodes.map(node=><g key={node.id} data-d3-sankey-node="true"
            tabIndex={multicolorColumns || (node.kind==="resource"&&node.uri)?0:undefined}
            role={multicolorColumns || (node.kind==="resource"&&node.uri)?"button":undefined}
            aria-pressed={multicolorColumns ? selectedNode===node.id : undefined}
            aria-label={multicolorColumns ? `Isolate streams through ${node.name}. Shift-click to open resource.`
              :node.kind==="resource"&&node.uri?`Open ${node.name} in Record`:undefined}
            className={multicolorColumns || (node.kind==="resource"&&node.uri)?"cursor-pointer":undefined}
            onClick={event=>{
              if(multicolorColumns && !event.shiftKey && !event.metaKey && !event.ctrlKey){
                setSelectedNode(previous=>previous===node.id?null:node.id);return;
              }
              if(node.kind==="resource"&&node.uri)onOpenResource(node.uri);
            }}
            onDoubleClick={()=>{if(node.kind==="resource"&&node.uri)onOpenResource(node.uri);}}
            onKeyDown={event=>{if(event.key!=="Enter"&&event.key!==" ")return;
              event.preventDefault();
              if(multicolorColumns && !event.shiftKey){setSelectedNode(previous=>previous===node.id?null:node.id);return;}
              if(node.kind==="resource"&&node.uri)onOpenResource(node.uri);
            }}>
            <rect x={node.x0} y={node.y0} width={Math.max(1,node.x1-node.x0)} height={Math.max(1,node.y1-node.y0)} rx={2}
              fill={nodeColor(node)} fillOpacity={streamFocus && !streamFocus.nodes.has(node.id)?0.1:nodeOpacity}
              stroke={streamFocus?.nodes.has(node.id) && node.id===selectedNode?"var(--foreground)":"var(--border)"}
              strokeWidth={node.id===selectedNode?Math.max(2,nodeStrokeWidth):nodeStrokeWidth}/>
            <title>{node.tooltip??`${node.name}: ${format(node.value??0)}`}</title>
            {showLabels && <text x={node.x1+labelPadding} y={(node.y0+node.y1)/2} dominantBaseline="middle" fontSize="11"
              fill="var(--foreground)" opacity={streamFocus && !streamFocus.nodes.has(node.id)?0.3:1}
              className={node.kind==="resource"&&node.uri?"cursor-pointer":undefined}
              pointerEvents={node.kind==="resource"&&node.uri?"auto":"none"}
              onClick={event=>{if(node.kind==="resource"&&node.uri){event.stopPropagation();onOpenResource(node.uri);}}}>
              {node.name.length>35?`${node.name.slice(0,34)}…`:node.name}
            </text>}
          </g>)}</g>
        </g>
      </svg>
    </div>}
    <p className="text-xs text-muted-foreground">The D3 provider shares the same FCT focus, forward query-tree traversal, result pagination and predicate-coverage weights as Recharts. Controls and zoom are presentation-only; drag the chart background to pan. In multicolor mode, click a node to isolate its incoming and outgoing paths; click it again or use Show all streams to clear. Click a resource label, double-click the node, or Shift-click to open Record. No personal graph updates.</p>
  </div>;
}
