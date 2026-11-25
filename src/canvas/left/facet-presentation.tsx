"use client";
import { facetButtonFactory, completeFacetButton } from "@/components/ui/facet-button-factory";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";

/** A neutral host for approved, SHACL-applicable facet presentation providers.
 * Provider XSLT owns shapes, ordering, palette, labels, controls and geometry.
 * The host permits one safe interaction: delegating an RDF-term checkbox toggle.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { readClientPolicyApprovals } from "@/lib/client-policy-approvals";
import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import type { FacetTrayActions } from "@/components/ui/left-widget-button-tray";
import { providerStorage } from "@/lib/maestro-storage";
import { browserLog } from "@/lib/maestro-client-logging";
import { ErrorDetails } from "@/components/ui/error-details";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InputGroup, InputGroupAddon, InputGroupText } from "@/components/ui/input-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const validIri = (value: string) => value.length > 0 && value.length <= 4096 && /^[a-z][a-z0-9+.-]*:[^\s<>\"{}|^`\\]+$/i.test(value);
const icons = new Set<string>(iconNames);
type Provider = { uri: string; label: string; icon: string; stylesheet: string; requestsClassTree: boolean };
export type FacetPresentation = {
  active: boolean; provider: Provider | null; providers: Provider[];
  phase: "idle" | "loading" | "ready" | "error";
  error: string; wantsClassTree: boolean; toggle: () => void; select: (uri: string) => void;
};

export function useFacetPresentation({direction, predicate, enabled, approvalRevision, sessionKey}: {
  direction: "class" | "forward" | "reverse"; predicate: string;
  enabled: boolean; approvalRevision: number; sessionKey: string;
}): FacetPresentation {
  const [state, setState] = useState<{key: string; providers: Provider[]; phase: FacetPresentation["phase"]; error: string}>({key:"",providers:[],phase:"idle",error:""});
  const [choice, setChoice] = useState<{scope: string; uri: string; active: boolean}>({scope:"",uri:"",active:false});
  const scope = `${sessionKey}|${direction}|${predicate}`;
  const key = `${scope}|${approvalRevision}|${enabled}`;
  useEffect(() => {
    if (!enabled || !validIri(predicate)) return;
    const controller = new AbortController();
    setState({key, providers:[], phase:"loading", error:""});
    void (async () => {
      try {
        const ctx = await personalContext();
        if (controller.signal.aborted) return;
        const rows = await selectPersonal(`PREFIX mui: <${MUI}>
          PREFIX sh: <http://www.w3.org/ns/shacl#>
          PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
          SELECT DISTINCT ?provider ?label ?icon ?stylesheet ?requestsClassTree WHERE {
            GRAPH <${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}> {
              ?provider a mui:Provider ; mui:accepts ?shape ; mui:widget ?widget .
              ?shape a mui:InputShape ; sh:path <${predicate}> ; mui:facetDirection "${direction}" .
              ?widget a mui:FacetWidget ; mui:templateContent ?stylesheet .
              OPTIONAL { ?provider rdfs:label ?label }
              OPTIONAL { ?provider mui:icon ?icon }
              OPTIONAL { ?provider mui:requestsClassTree ?requestsClassTree }
            }
          } LIMIT 50`, ctx, controller.signal,"facet-presentation:useFacetPresentation");
        const candidates = rows.map(row => ({uri:row.provider?.value??"",label:row.label?.value??"Facet view",
          icon:row.icon?.value??"chart-pie",stylesheet:row.stylesheet?.value??"",
          requestsClassTree:row.requestsClassTree?.value==="true"}))
          .filter(row => validIri(row.uri) && row.stylesheet.length > 0 && row.stylesheet.length <= 250000);
        const decisions = await readClientPolicyApprovals(candidates.map(row=>row.uri), controller.signal);
        if (controller.signal.aborted) return;
        const approved = new Set(decisions.filter(row=>row.status === "Approved").map(row=>row.uri));
        setState({key, providers:candidates.filter(row=>approved.has(row.uri))
          .sort((a,b)=>a.label.localeCompare(b.label)||a.uri.localeCompare(b.uri)), phase:"ready",error:""});
      } catch (error) {
        if (controller.signal.aborted) return;
        browserLog.warn("facet-presentation.discovery.unavailable", error);
        setState({key,providers:[],phase:"error",error:"Provider discovery unavailable"});
      }
    })();
    return () => controller.abort();
  }, [key, predicate, direction, enabled]);
  const providers = enabled && state.key === key && state.phase === "ready" ? state.providers : [];
  const provider = providers.find(row=>choice.scope===scope && row.uri===choice.uri) ?? providers[0] ?? null;
  const active = !!provider && (choice.scope!==scope || choice.active);
  return {provider, providers, active, wantsClassTree:active && Boolean(provider?.requestsClassTree), phase:state.key === key ? state.phase : "idle", error:state.key === key ? state.error : "",
    toggle:()=> { if (!provider) return; setChoice({scope, uri:provider.uri,active:!active}); },
    select:(uri:string)=> {if(providers.some(row=>row.uri===uri))setChoice({scope,uri,active:true});}};
}

export function FacetPresentationButton({presentation}: {presentation:FacetPresentation}) {
  const provider = presentation.provider;
  if (!provider) return null;
  return <Tooltip><TooltipTrigger render={completeFacetButton(facetButtonFactory(<DynamicIcon name={(icons.has(provider.icon) ? provider.icon : "chart-pie") as IconName} className="size-4" aria-hidden="true"/>), {"type":"button", "aria-pressed":(presentation.active), "onClick":(presentation.toggle), "title":(provider.label), "className":(`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 ${presentation.active ? "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100" : ""}`), "aria-label":(presentation.active ? `Show facet checkboxes instead of ${provider.label}` : `Show ${provider.label}`)})} /><TooltipContent>{presentation.active ? "Show checkboxes" : provider.label}</TooltipContent></Tooltip>;
}

type Item = {uri:string;label:string;count:number;selected:boolean};
/** Generic nested facet values; presentation XSLT determines their visualization. */
type FacetNode = {item:{uri:string;count:number;label?:string};children:FacetNode[]};
const escapeXml = (value:string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const ALLOWED = new Set(["div","span","p","button","svg","g","path","circle","text","textpath","defs","title"]);
const ATTRS = new Set(["class","role","aria-label","aria-checked","tabindex","viewbox","width","height","d","cx","cy","r","fill","stroke","stroke-width","x","y","font-size","font-weight","text-anchor","pointer-events","data-facet-value","id","href","startoffset","data-facet-label-style","data-facet-lineage","transform","display","overflow","type","data-facet-action"]);
/** Only inert, allowlisted SVG/HTML survives provider output. Event handlers and URL attributes do not. */
function sanitizeMarkup(raw:string):string {
  const doc = new DOMParser().parseFromString(raw,"text/html");
  const traverse = (node:Element) => {
    for (const child of Array.from(node.children)) {
      if (!ALLOWED.has(child.localName.toLowerCase())) {child.remove();continue;}
      for (const attr of Array.from(child.attributes)) {
        const name=attr.name.toLowerCase();
        // SVG textPath must only reference a generated path inside this chart.
        // All other URL-bearing attributes are still rejected by the allowlist.
        if (!ATTRS.has(name) ||
          (name==="data-facet-label-style" && (child.localName.toLowerCase()!=="g" || !["arc","radial"].includes(attr.value))) ||
          // Only permit the provider's fixed 2.5x chart-scale group and
          // existing label rotations. Never accept arbitrary SVG transforms.
          (name==="transform" && !((child.localName.toLowerCase()==="text" && /^rotate\(-?[0-9.]+ [0-9.]+ [0-9.]+\)$/.test(attr.value)) ||
            (child.localName.toLowerCase()==="g" && attr.value==="scale(2.5)"))) ||
          (name==="data-facet-lineage" && !/^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/.test(attr.value)) ||
          (name==="display" && (child.localName.toLowerCase()!=="g" || attr.value!=="none")) ||
          (name==="overflow" && (child.localName.toLowerCase()!=="svg" || attr.value!=="visible")) ||
          (name==="type" && (child.localName!=="button" || attr.value!=="button")) ||
          (name==="data-facet-action" && (child.localName!=="button" || !/^[a-z][a-z0-9-]{0,63}$/.test(attr.value))) ||
          (name==="id" && (child.localName.toLowerCase()!=="path" || !/^maestro-sunburst-label-(?:pct-)?[a-zA-Z0-9_-]+$/.test(attr.value))) ||
          (name==="href" && (child.localName.toLowerCase()!=="textpath" || !/^#maestro-sunburst-label-(?:pct-)?[a-zA-Z0-9_-]+$/.test(attr.value))) ||
          (name==="startoffset" && (child.localName.toLowerCase()!=="textpath" || attr.value!=="50%")) ||
          (name==="pointer-events" && attr.value!=="none") || (name==="data-facet-value" && !validIri(attr.value)) ||
          (name==="d" && !/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\sEe]+$/.test(attr.value)) ||
          (["fill","stroke"].includes(name) && !/^(?:none|currentColor|var\(--background\)|hsl\([0-9.]+ [0-9.]+% [0-9.]+%\))$/.test(attr.value))) child.removeAttribute(attr.name);
      }
      if(child.localName==="button")child.setAttribute("type","button");
      traverse(child);
    }
  };
  traverse(doc.body);
  return doc.body.innerHTML;
}
export function FacetPresentationSurface({presentation,items,tree,onToggle,storageScope,actions}: {
  presentation:FacetPresentation;storageScope:string;actions?:FacetTrayActions;items:Item[];tree?:FacetNode[];onToggle:(uri:string,checked:boolean)=>void;
}) {
  const [result,setResult]=useState<{key:string;html:string;error:string}>({key:"",html:"",error:""});
  const [labelStyle,setLabelStyle]=useState<"arc"|"radial">("arc");
  const [resizeActive,setResizeActive]=useState(false);
  const [resizeWidth,setResizeWidth]=useState<number|null>(null);
  const [dimensionStorageReady,setDimensionStorageReady]=useState<ReturnType<typeof providerStorage> | null>(null);
  const resizeWidthRef=useRef<number|null>(null);
  const storage=useMemo(()=>presentation.provider && storageScope ? providerStorage(presentation.provider.uri,storageScope) : null,[presentation.provider?.uri,storageScope]);
  useEffect(()=>{
    let current=true;
    resizeWidthRef.current=null; setResizeWidth(null); setResizeActive(false);
    if(!storage){setDimensionStorageReady(null);return;}
    void storage.get("dimensions").then(raw=>{
      if(!current || resizeWidthRef.current!==null || !raw)return;
      const saved=JSON.parse(raw) as {width?:number};
      if(typeof saved.width==="number" && Number.isFinite(saved.width) && saved.width>=100 && saved.width<=10000){
        resizeWidthRef.current=saved.width;setResizeWidth(saved.width);
      }
    }).catch(error=>browserLog.warn("facet-presentation.storage.read",error)).finally(()=>{if(current)setDimensionStorageReady(storage);});
    return ()=>{current=false;};
  },[storage]);
  const changeWidth=(width:number,persist=false)=>{
    resizeWidthRef.current=width;setResizeWidth(width);
    if(persist)void storage?.set("dimensions",JSON.stringify({width})).catch(error=>browserLog.warn("facet-presentation.storage.write",error));
  };
  const [naturalWidth,setNaturalWidth]=useState(420);
  const frameRef=useRef<HTMLDivElement>(null);
  const originalViews=useRef(new WeakMap<SVGSVGElement,{x:number;y:number;width:number;height:number}>());
  const resizeDrag=useRef<{x:number;y:number;width:number;height:number}|null>(null);
  const [hoverDescription,setHoverDescription]=useState("");
  const surfaceRef=useRef<HTMLDivElement>(null);
  const tooltipRef=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const root=surfaceRef.current;
    if(!root || result.error)return;
    root.querySelectorAll<SVGGElement>("[data-facet-label-style]").forEach(group=>{
      group.style.display=group.getAttribute("data-facet-label-style")===labelStyle ? "inline" : "none";
    });
    const svg=root.querySelector<SVGSVGElement>("svg");
    if(!svg)return;
    // SVG geometry, not the outermost radius, determines occupied space.
    const native=svg.viewBox.baseVal;
    const original=originalViews.current.get(svg)??{x:native.x,y:native.y,width:native.width,height:native.height};
    originalViews.current.set(svg,original);
    try {
      const fallback=svg.getBBox();
      const inverse=svg.getScreenCTM()?.inverse();
      const points: DOMPoint[]=[];
      if(inverse) for(const element of svg.querySelectorAll<SVGGraphicsElement>("path[data-facet-value], circle, text")) {
        const styleGroup=element.closest("[data-facet-label-style]");
        if(element.closest("defs") || (styleGroup && styleGroup.getAttribute("data-facet-label-style")!==labelStyle)) continue;
        const matrix=element.getScreenCTM();
        if(!matrix || getComputedStyle(element).display==="none" || getComputedStyle(element).visibility==="hidden") continue;
        const bounds=element.getBBox();
        if(bounds.width<=0 || bounds.height<=0) continue;
        const local=inverse.multiply(matrix);
        for(const px of [bounds.x,bounds.x+bounds.width]) for(const py of [bounds.y,bounds.y+bounds.height])
          points.push(new DOMPoint(px,py).matrixTransform(local));
      }
      const x=points.length?Math.min(...points.map(p=>p.x)):fallback.x;
      const y=points.length?Math.min(...points.map(p=>p.y)):fallback.y;
      const width=points.length?Math.max(...points.map(p=>p.x))-x:fallback.width;
      const height=points.length?Math.max(...points.map(p=>p.y))-y:fallback.height;
      if(width>0 && height>0 && original.width>0 && [x,y,width,height].every(Number.isFinite)) {
        const pad=8;
        const cx=original.x+original.width/2, cy=original.y+original.height/2;
        const radius=Math.max(Math.abs(x-cx),Math.abs(x+width-cx),Math.abs(y-cy),Math.abs(y+height-cy))+pad;
        svg.setAttribute("viewBox",`${cx-radius} ${cy-radius} ${2*radius} ${2*radius}`);
        svg.removeAttribute("width"); svg.removeAttribute("height");
        svg.setAttribute("preserveAspectRatio","xMidYMid meet");
        svg.style.width="100%"; svg.style.height="auto"; svg.style.aspectRatio="1 / 1";
        setNaturalWidth(420*(2*radius)/original.width);
      }
    } catch { /* Non-SVG or unmeasurable provider output retains its native size. */ }
  },[result.key,result.html,result.error,labelStyle,dimensionStorageReady]);
  useEffect(()=>{
    if(!resizeActive)return;
    const outside=(event:globalThis.PointerEvent)=>{
      if(!frameRef.current?.contains(event.target as Node))setResizeActive(false);
    };
    const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==="Escape")setResizeActive(false);};
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);};
  },[resizeActive]);
  // Generic interaction for provider-authored hierarchical SVG: the XSLT
  // supplies ancestry tokens, while the host only applies presentation opacity.
  // No RDF query, category names, or chart geometry are implemented in React.
  const highlightLineage=(lineage:string | null)=>{
    const root=surfaceRef.current;
    if(!root)return;
    root.querySelectorAll<SVGElement>("[data-facet-lineage]").forEach(element=>{
      const path=element.getAttribute("data-facet-lineage")??"";
      const inBranch=!lineage || path===lineage || path.startsWith(`${lineage} `) || lineage.startsWith(`${path} `);
      element.style.opacity=inBranch ? "1" : (element.hasAttribute("data-facet-value") ? "0.15" : "0");
    });
  };
  // The sunburst's native SVG <title> is deliberately omitted by its XSLT.
  // Position one lightweight, non-interactive tooltip at the actual sector;
  // no shadcn TooltipTrigger can accidentally anchor it to the provider menu.
  const positionTooltip=(clientX:number,clientY:number)=>{
    const tooltip=tooltipRef.current;
    if(!tooltip)return;
    const width=Math.min(340,Math.max(160,window.innerWidth-24));
    tooltip.style.left=`${Math.max(12,Math.min(clientX+14,window.innerWidth-width-12))}px`;
    tooltip.style.top=`${Math.max(12,Math.min(clientY+16,window.innerHeight-72))}px`;
  };
  const hoverBranch=(target:EventTarget | null, keyboard=false)=>{
    const element=target instanceof Element ? target.closest("[data-facet-lineage]") : null;
    highlightLineage(element?.getAttribute("data-facet-lineage")??null);
    const wedge=target instanceof Element ? target.closest("[data-facet-value]") : null;
    setHoverDescription(wedge?.getAttribute("aria-label")??"");
    if(wedge && keyboard){const bounds=wedge.getBoundingClientRect();
      positionTooltip(bounds.left+bounds.width/2,bounds.top+bounds.height/2);}
  };
  const provider=presentation.provider;
  const input = useMemo(()=>items.filter(item=>validIri(item.uri) && Number.isFinite(item.count) && item.count>=0)
    .slice(0,250).map(item=>`<item uri="${escapeXml(item.uri)}" label="${escapeXml(item.label)}" count="${item.count}" selected="${item.selected ? "true" : "false"}"/>`).join(""),[items]);
  const itemByUri = new Map(items.map(item => [item.uri,item]));
  // Carry the already-derived hierarchy to the provider, without encoding any
  // chart geometry or hierarchy rules in the generic host.
  const hierarchyItems = new Map<string,Item>();
  const serializeNode = (node:FacetNode, depth:number):string => {
    const sourceItem = node.item;
    if(!validIri(sourceItem.uri) || depth>12)return "";
    // The superclass tree includes ancestor classes not present on the current
    // flat facet page. Never discard their entire subtree on that account.
    const presented=itemByUri.get(sourceItem.uri);
    const item:Item = presented ?? {uri:sourceItem.uri,
      label:sourceItem.label || sourceItem.uri,
      count:Number.isFinite(sourceItem.count) ? Math.max(0,sourceItem.count) : 0,
      selected:false};
    hierarchyItems.set(item.uri,item);
    const attrs=`uri="${escapeXml(item.uri)}" label="${escapeXml(item.label)}" count="${item.count}" selected="${item.selected ? "true" : "false"}"`;
    return `<node ${attrs}>${node.children.map(child=>serializeNode(child,depth+1)).join("")}</node>`;
  };
  const hierarchy = tree?.length ? tree.map(node=>serializeNode(node,0)).join("")
    : items.filter(item=>validIri(item.uri)).map(item=>serializeNode({item,children:[]},0)).join("");
  const tray=actions?.list().map(action=>`<action id="${escapeXml(action.id)}" label="${escapeXml(action.label)}" disabled="${action.disabled}"/>`).join("")??"";
  const source = `<facet>${input}<hierarchy>${hierarchy}</hierarchy><actions>${tray}</actions></facet>`;
  const key=provider ? `${provider.uri}|${provider.stylesheet}|${source}` : "";
  useEffect(()=>{setHoverDescription("");},[key]);
  useEffect(()=>{
    if (!presentation.active || !provider) return;
    const controller=new AbortController();
    void transformWithMaestroSaxon(provider.stylesheet,source,{signal:controller.signal})
      .then(output=>{if(!controller.signal.aborted)setResult({key,html:sanitizeMarkup(output),error:""});})
      .catch(error=>{if(!controller.signal.aborted){browserLog.warn("facet-presentation.transform.unavailable",error);
        setResult({key,html:"",error:error instanceof Error ? `${error.name}: ${error.message}` : "Facet XSLT rendering failed."});}});
    return ()=>controller.abort();
  },[presentation.active,provider,key,source]);
  const select=(target:EventTarget, keyboard=false, code="")=>{
    if(keyboard && code!=="Enter" && code!==" ")return false;
    const node=(target as Element).closest?.("[data-facet-value]");
    const uri=node?.getAttribute("data-facet-value")??"";
    const item=itemByUri.get(uri)??hierarchyItems.get(uri);
    if(!item || !validIri(uri))return false;
    onToggle(uri,!item.selected);
    return true;
  };
  if(result.key!==key || (storage && dimensionStorageReady!==storage))return <p role="status" className="text-xs text-muted-foreground">Rendering facet presentation…</p>;
  if(result.error)return <ErrorDetails prefix="Facet rendering" error={result.error} />;
  return <div className="flex w-full min-w-0 flex-none flex-col gap-1">
    <div className="flex w-full flex-wrap items-center justify-center gap-1.5 px-1 pt-0.5">
      {/* Follow the Record header's Graph selector: muted leading label, a
          single outlined shell, and a plain chevron dropdown trigger. */}
      <InputGroup className="!w-auto max-w-full !flex-nowrap items-stretch overflow-hidden rounded-md border border-input bg-background text-xs shadow-none">
        <InputGroupAddon align="inline-start" className="h-7 shrink-0 border-r bg-muted/40 px-1.5 text-muted-foreground">
          <InputGroupText className="text-xs">Provider</InputGroupText>
        </InputGroupAddon>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Select approved Categories facet renderer"
              disabled={presentation.providers.length<=1}
              title={provider?.label??"Provider"}
              className="inline-flex h-7 min-w-0 max-w-40 items-center gap-1 px-2 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-70">
              <span className="truncate">{provider?.label??"Provider"}</span>
              <ChevronDown className="size-3.5 shrink-0" aria-hidden="true"/>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-80 max-w-[calc(100vw-24px)] overflow-auto">
            {presentation.providers.map(option=><DropdownMenuItem key={option.uri}
              onSelect={()=>presentation.select(option.uri)} aria-current={provider?.uri===option.uri ? "true" : undefined}>
              {option.label}
            </DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </InputGroup>
      {/* Exactly one InputGroup outline around two actual ToggleGroup buttons.
          No separate button boxes, no extra Radial/Arc control. */}
      <InputGroup className="!w-auto !flex-nowrap items-stretch overflow-hidden rounded-md border border-input bg-background text-xs shadow-none"
        aria-label="Sunburst label layout controls">
        <ToggleGroup type="single" aria-label="Sunburst label layout" value={labelStyle}
          onValueChange={value=>{if(value==="radial" || value==="arc")setLabelStyle(value);}}
          className="h-7 gap-0">
          <ToggleGroupItem unstyled value="radial" aria-label="Radial labels"
            className="inline-flex h-7 min-w-10 items-center justify-center px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-foreground">Radial</ToggleGroupItem>
          <ToggleGroupItem unstyled value="arc" aria-label="Arc labels"
            className="inline-flex h-7 min-w-10 items-center justify-center border-l border-input px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-foreground">Arc</ToggleGroupItem>
        </ToggleGroup>
      </InputGroup>
    </div>
    <div ref={frameRef} className={`relative mx-auto min-w-0 max-w-full flex-none ${resizeActive ? "outline outline-1 outline-ring" : ""}`}
      style={{width:`${resizeWidth??naturalWidth}px`}}>
    <div ref={surfaceRef}
      className="flex w-full min-w-0 items-center justify-center [&>div]:w-full [&>div]:!p-0 [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_svg]:overflow-visible"
      data-facet-provider={provider?.uri}
      onPointerOver={(event:PointerEvent<HTMLDivElement>)=>{hoverBranch(event.target);
        if((event.target as Element).closest?.("[data-facet-value]"))positionTooltip(event.clientX,event.clientY);}}
      onPointerMove={(event:PointerEvent<HTMLDivElement>)=>{
        if((event.target as Element).closest?.("[data-facet-value]"))positionTooltip(event.clientX,event.clientY);}}
      onPointerLeave={()=>{highlightLineage(null);setHoverDescription("");}}
      onFocusCapture={(event:FocusEvent<HTMLDivElement>)=>hoverBranch(event.target,true)}
      onBlurCapture={(event:FocusEvent<HTMLDivElement>)=>{
        if(!event.currentTarget.contains(event.relatedTarget as Node | null)){highlightLineage(null);setHoverDescription("");}
      }}
      onClick={(event:MouseEvent<HTMLDivElement>)=>{
        const command=(event.target as Element).closest?.("button[data-facet-action]");
        if(command){if(presentation.active)actions?.press(command.getAttribute("data-facet-action")??"");return;}
        if(!select(event.target))setResizeActive(true);}}
      onKeyDown={(event:KeyboardEvent<HTMLDivElement>)=>{if(select(event.target,true,event.key))event.preventDefault();}}
      dangerouslySetInnerHTML={{__html:result.html}}/>
    {resizeActive && <button type="button" aria-label="Resize Sunburst" title="Drag to resize; arrow keys resize; Escape closes"
      className="absolute bottom-0 right-0 z-10 size-5 cursor-nwse-resize touch-none appearance-none border-0 bg-transparent shadow-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={event=>{event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
        const bounds=frameRef.current?.getBoundingClientRect();if(bounds)resizeDrag.current={x:event.clientX,y:event.clientY,width:bounds.width,height:bounds.height};}}
      onPointerMove={event=>{const drag=resizeDrag.current;if(!drag)return;
        const dx=(event.clientX-drag.x)/Math.max(1,drag.width), dy=(event.clientY-drag.y)/Math.max(1,drag.height);
        const scale=1+(Math.abs(dx)>=Math.abs(dy)?dx:dy);
        changeWidth(Math.max(100,Math.min(10000,drag.width*scale)));}}
      onPointerUp={()=>{if(resizeDrag.current && resizeWidthRef.current!==null)changeWidth(resizeWidthRef.current,true);resizeDrag.current=null;}} onLostPointerCapture={()=>{resizeDrag.current=null;}}
      onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;
        event.preventDefault();const width=frameRef.current?.clientWidth??naturalWidth;
        changeWidth(Math.max(100,Math.min(10000,width+(["ArrowRight","ArrowDown"].includes(event.key)?12:-12))),true);}}/>}
    </div>
    <div ref={tooltipRef} role="tooltip" hidden={!hoverDescription}
      className="pointer-events-none fixed z-50 max-w-[min(340px,calc(100vw-24px))] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-snug text-popover-foreground shadow-md"
      style={{left:12,top:12}}>{hoverDescription}</div>
  </div>;
}
