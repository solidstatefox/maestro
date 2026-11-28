"use client";
import { facetButtonFactory, completeFacetButton } from "@/components/ui/facet-button-factory";
import { useFacetProviderQueue, useFacetProviderRendered } from "@/canvas/diagnostics/facet-provider-progress";
import type { FacetProviderActivity } from "@/lib/app-lifecycle/facet-provider-progress";
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
import { FRAME_EDGES, frameScale, includePaint, readFrameBounds, resizeFrameCorner, resizeFrameEdge, sameFrame, type FrameBounds, type FrameDimensions, type FrameHandle } from "@/lib/facet-frame-bounds";
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
  activity: FacetProviderActivity;
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
  const { attempt, queued, watch } = useFacetProviderQueue(enabled && validIri(predicate) ? key : "");
  useEffect(() => {
    if (!enabled || !validIri(predicate)) return;
    const controller = new AbortController();
    const close = watch(controller.signal);
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
          } LIMIT 50`, ctx, controller.signal,"facet-presentation:useFacetPresentation","view",{tab:"shared",ribbon:"query"});
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
    return () => { controller.abort(); close(); };
  }, [key, predicate, direction, enabled, watch]);
  const providers = enabled && state.key === key && state.phase === "ready" ? state.providers : [];
  const provider = providers.find(row=>choice.scope===scope && row.uri===choice.uri) ?? providers[0] ?? null;
  const active = !!provider && (choice.scope!==scope || choice.active);
  return {provider, providers, active, activity:{attempt,queued,discovering:state.key===key && state.phase==="loading"}, wantsClassTree:active && Boolean(provider?.requestsClassTree), phase:state.key === key ? state.phase : "idle", error:state.key === key ? state.error : "",
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
const ATTRS = new Set(["class","role","aria-label","aria-checked","tabindex","viewbox","width","height","d","cx","cy","r","fill","stroke","stroke-width","stroke-linejoin","x","y","font-size","font-weight","text-anchor","pointer-events","data-facet-value","id","href","startoffset","data-facet-label-style","data-facet-lineage","transform","display","overflow","type","data-facet-action"]);
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
          (name==="stroke-linejoin" && (child.localName.toLowerCase()!=="path" || attr.value!=="round")) ||
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
  const [frameBounds,setFrameBounds]=useState<FrameDimensions|null>(null);
  const [dimensionStorageReady,setDimensionStorageReady]=useState<ReturnType<typeof providerStorage> | null>(null);
  const frameBoundsRef=useRef<FrameDimensions|null>(null);
  const paintBoundsRef=useRef<FrameBounds|null>(null);
  const storage=useMemo(()=>presentation.provider && storageScope ? providerStorage(presentation.provider.uri,storageScope) : null,[presentation.provider?.uri,storageScope]);
  const frameRef=useRef<HTMLDivElement>(null);
  const viewportRef=useRef<HTMLDivElement>(null);
  const [displayScale,setDisplayScale]=useState(1);
  const resizeDrag=useRef<{handle:FrameHandle;pointerId:number;x:number;y:number;frame:FrameDimensions;paint:FrameBounds;scale:number;rect:DOMRect}|null>(null);
  useEffect(()=>{
    let current=true;
    frameBoundsRef.current=null;paintBoundsRef.current=null;resizeDrag.current=null;
    if(frameRef.current)frameRef.current.style.transform="none";
    if(viewportRef.current)viewportRef.current.style.overflow="";
    setFrameBounds(null);setResizeActive(false);
    if(!storage){setDimensionStorageReady(null);return;}
    void storage.get("dimensions").then(raw=>{
      if(!current)return;
      const saved=readFrameBounds(raw);
      frameBoundsRef.current=saved;setFrameBounds(saved);
    }).catch(error=>browserLog.warn("facet-presentation.storage.read",error)).finally(()=>{if(current)setDimensionStorageReady(storage);});
    return ()=>{current=false;};
  },[storage]);
  const persistFrame=(bounds:FrameDimensions)=>{
    void storage?.set("dimensions",JSON.stringify(bounds)).catch(error=>browserLog.warn("facet-presentation.storage.write",error));
  };
  // The display scale depends on the pane, never on the current rectangle.
  // A separate saved zoom allows uniform scaling without coupling pane and frame dimensions.
  useLayoutEffect(()=>{
    const viewport=viewportRef.current;
    if(!viewport)return;
    const update=()=>{if(viewport.clientWidth>0)setDisplayScale(Math.min(1,viewport.clientWidth/420));};
    update();
    const observer=typeof ResizeObserver!=="undefined" ? new ResizeObserver(update):null;
    observer?.observe(viewport);
    return ()=>observer?.disconnect();
  },[result.key,result.html,dimensionStorageReady]);
  const applyFrame=(svg:SVGSVGElement,bounds:FrameDimensions,persist=false)=>{
    const width=bounds.right-bounds.left,height=bounds.bottom-bounds.top;
    const view=[bounds.left,bounds.top,width,height].map(v=>Math.round(v*1000)/1000).join(" ");
    if(svg.getAttribute("viewBox")!==view)svg.setAttribute("viewBox",view);
    if(svg.hasAttribute("width"))svg.removeAttribute("width");
    if(svg.hasAttribute("height"))svg.removeAttribute("height");
    if(svg.getAttribute("preserveAspectRatio")!=="xMidYMid meet")svg.setAttribute("preserveAspectRatio","xMidYMid meet");
    svg.style.width="100%";svg.style.height="auto";svg.style.maxWidth="100%";svg.style.maxHeight="none";
    svg.style.aspectRatio=`${Math.round(width*1000)/1000} / ${Math.round(height*1000)/1000}`;
    if(!sameFrame(frameBoundsRef.current,bounds)){
      frameBoundsRef.current=bounds;setFrameBounds(bounds);
      if(persist)persistFrame(bounds);
    }
  };
  const changeFrame=(handle:FrameHandle,dx:number,dy:number,base=frameBoundsRef.current,paint=paintBoundsRef.current,persist=false)=>{
    const svg=surfaceRef.current?.querySelector<SVGSVGElement>("svg");
    if(!base || !paint || !svg)return;
    const next=handle==="corner" ? resizeFrameCorner(base,dx,dy) : resizeFrameEdge(base,paint,handle,handle==="left" || handle==="right" ? dx : dy);
    applyFrame(svg,next);
    if(persist)persistFrame(next);
  };
  // Keep the opposite edge/corner stationary while the pointer is captured.
  // The normal flow re-centers the final rectangle when the gesture ends.
  useLayoutEffect(()=>{
    const frame=frameRef.current,drag=resizeDrag.current;
    if(!frame || !drag)return;
    frame.style.transform="none";
    const rect=frame.getBoundingClientRect();
    const dx=drag.handle==="left" ? drag.rect.right-rect.right : drag.handle==="right" || drag.handle==="corner" ? drag.rect.left-rect.left : (drag.rect.left+drag.rect.right-rect.left-rect.right)/2;
    const dy=drag.handle==="top" ? drag.rect.bottom-rect.bottom : drag.handle==="bottom" || drag.handle==="corner" ? drag.rect.top-rect.top : (drag.rect.top+drag.rect.bottom-rect.top-rect.bottom)/2;
    frame.style.transform=`translate(${dx}px, ${dy}px)`;
  },[frameBounds,displayScale]);
  const [hoverDescription,setHoverDescription]=useState("");
  const surfaceRef=useRef<HTMLDivElement>(null);
  const tooltipRef=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const root=surfaceRef.current;
    if(!root || result.error)return;
    let disposed=false, scheduled=0, warned=false;
    // Arc textPath bounding boxes can shift slightly when the SVG's own viewBox
    // changes. ResizeObserver sees the resulting layout change, so measuring
    // again in response to that resize creates a viewBox/width feedback loop.
    // The chart is authored in fixed SVG user coordinates: resizing the
    // viewport and CSS zoom does not change the sector geometry.
    let settledSvg: SVGSVGElement | null = null;
    let settledPaint: FrameBounds | null = null;
    let pendingForce=false;
    const measure=(force=false)=>{
      if(disposed || !root.isConnected)return;
      root.querySelectorAll<SVGGElement>("[data-facet-label-style]").forEach(group=>{
        group.style.display=group.getAttribute("data-facet-label-style")===labelStyle ? "inline" : "none";
      });
      const svg=root.querySelector<SVGSVGElement>("svg");
      if(!svg || svg.getBoundingClientRect().width<=0)return;
      if(!force && settledSvg===svg)return;
      try {
        // Convert actual visible geometry to SVG user units. Neither saved
        // frame dimensions nor the provider's original viewBox sets padding.
        const inverse=svg.getScreenCTM()?.inverse();
        if(!inverse)return;
        const points: DOMPoint[]=[];
        const elements=svg.querySelectorAll<SVGGraphicsElement>("path[data-facet-value], circle, text");
        for(const element of elements) {
          const styleGroup=element.closest("[data-facet-label-style]");
          if(element.closest("defs") || (styleGroup && styleGroup.getAttribute("data-facet-label-style")!==labelStyle)) continue;
          const style=getComputedStyle(element);
          if(style.display==="none" || style.visibility==="hidden")continue;
          try {
            const matrix=element.getScreenCTM();
            if(!matrix)continue;
            const bounds=element.getBBox();
            if(bounds.width<=0 || bounds.height<=0)continue;
            const stroke=style.stroke==="none" ? 0 : Math.max(0,parseFloat(style.strokeWidth)||0)/2;
            const local=inverse.multiply(matrix);
            // Individual glyph extents avoid treating a rotated whole-label
            // bounding box as a large empty corner of the chart.
            let boxes=[bounds];
            if(element.localName==="text") {
              const text=element as SVGTextElement;
              try {
                const glyphs=Array.from({length:text.getNumberOfChars()},(_,i)=>text.getExtentOfChar(i)).filter(box=>box.width>0 && box.height>0);
                if(glyphs.length)boxes=glyphs;
              } catch { /* fall back to the whole visible label */ }
            }
            for(const box of boxes) for(const px of [box.x-stroke,box.x+box.width+stroke]) for(const py of [box.y-stroke,box.y+box.height+stroke])
              points.push(new DOMPoint(px,py).matrixTransform(local));
          } catch { /* A temporarily unmeasurable label must not hide all sectors. */ }
        }
        if(!points.length && elements.length)return; // hidden or not yet laid out
        const fallback=points.length?null:svg.getBBox();
        const x=points.length?Math.min(...points.map(p=>p.x)):fallback!.x;
        const y=points.length?Math.min(...points.map(p=>p.y)):fallback!.y;
        const width=points.length?Math.max(...points.map(p=>p.x))-x:fallback!.width;
        const height=points.length?Math.max(...points.map(p=>p.y))-y:fallback!.height;
        if(width>0 && height>0 && [x,y,width,height].every(Number.isFinite)) {
          // Tight paint extents in the provider's fixed coordinate system.
          // A newly occupied arc grows only the edge it actually crosses.
          const pad=1;
          const proposed={left:x-pad,top:y-pad,right:x+width+pad,bottom:y+height+pad};
          const paint=sameFrame(settledPaint,proposed,0.5) ? settledPaint! : proposed;
          settledPaint=paint;
          if(resizeDrag.current && !sameFrame(resizeDrag.current.paint,paint,0.5)){
            resizeDrag.current=null;
            if(frameRef.current)frameRef.current.style.transform="none";
            if(viewportRef.current)viewportRef.current.style.overflow="";
            if(frameBoundsRef.current)persistFrame(frameBoundsRef.current);
          }
          paintBoundsRef.current=paint;
          applyFrame(svg,includePaint(frameBoundsRef.current,paint),true);
          settledSvg=svg;
        }
      } catch(error) {
        if(!warned){warned=true;browserLog.warn("facet-presentation.bounds.unavailable",error);}
      }
    };
    const schedule=(force=false)=>{
      if(disposed)return;
      pendingForce ||= force;
      if(scheduled)return;
      scheduled=requestAnimationFrame(()=>{
        scheduled=0;
        const forced=pendingForce;
        pendingForce=false;
        measure(forced);
      });
    };
    measure(true);
    // Wait for a previously hidden chart to gain size, but do not remeasure
    // an already settled SVG when its own updated aspect ratio resizes root.
    const resizeObserver=typeof ResizeObserver!=="undefined"
      ? new ResizeObserver(()=>{
          if(root.querySelector("svg")!==settledSvg)schedule(true);
        }) : null;
    resizeObserver?.observe(root);
    // React may replace the rendered provider DOM. Observing our own viewBox,
    // width, and height writes would create a perpetual arc-label feedback loop.
    const mutationObserver=new MutationObserver(()=>schedule(true));
    mutationObserver.observe(root,{childList:true,subtree:true});
    const fonts=document.fonts;
    const onFontLoaded=()=>schedule(true);
    fonts?.addEventListener("loadingdone",onFontLoaded);
    void fonts?.ready.then(onFontLoaded).catch(()=>{});
    return ()=>{
      disposed=true;
      if(scheduled)cancelAnimationFrame(scheduled);
      resizeObserver?.disconnect();mutationObserver.disconnect();
      fonts?.removeEventListener("loadingdone",onFontLoaded);
    };
  },[result.key,result.html,result.error,labelStyle,dimensionStorageReady]);
  useEffect(()=>{
    if(!resizeActive)return;
    const outside=(event:globalThis.PointerEvent)=>{
      if(!resizeDrag.current && !frameRef.current?.contains(event.target as Node))setResizeActive(false);
    };
    const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==="Escape"){
      if(resizeDrag.current){
        resizeDrag.current=null;
        if(frameRef.current)frameRef.current.style.transform="none";
        if(viewportRef.current)viewportRef.current.style.overflow="";
        if(frameBoundsRef.current)persistFrame(frameBoundsRef.current);
      }
      setResizeActive(false);
    }};
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
  useFacetProviderRendered(Boolean(result.key===key && (!storage || dimensionStorageReady===storage)));
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
    <div ref={viewportRef} className="w-full min-w-0 overflow-x-auto p-px">
    <div ref={frameRef} className={`relative mx-auto min-w-0 flex-none ${resizeActive ? "outline outline-1 outline-ring" : ""}`}
      style={{width:`${(frameBounds ? frameBounds.right-frameBounds.left : 420)*displayScale*frameScale(frameBounds)}px`,height:frameBounds ? `${(frameBounds.bottom-frameBounds.top)*displayScale*frameScale(frameBounds)}px`:undefined}}>
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
    {resizeActive && frameBounds && ([...FRAME_EDGES,"corner"] as FrameHandle[]).map(handle=>{
      const horizontal=handle==="left" || handle==="right";
      const position={left:"left-0 inset-y-2 w-2 cursor-ew-resize",right:"right-0 top-2 bottom-5 w-2 cursor-ew-resize",top:"top-0 inset-x-2 h-2 cursor-ns-resize",bottom:"bottom-0 left-2 right-5 h-2 cursor-ns-resize",corner:"bottom-0 right-0 size-5 cursor-nwse-resize"}[handle];
      const finish=(event:PointerEvent<HTMLButtonElement>)=>{
        if(resizeDrag.current?.handle!==handle || resizeDrag.current.pointerId!==event.pointerId)return;
        resizeDrag.current=null;
        if(frameRef.current)frameRef.current.style.transform="none";
        if(viewportRef.current)viewportRef.current.style.overflow="";
        if(frameBoundsRef.current)persistFrame(frameBoundsRef.current);
      };
      return <button key={handle} type="button" aria-label={handle==="corner" ? "Resize Sunburst" : `Resize Sunburst ${handle} edge`}
        title={handle==="corner" ? "Scale Sunburst diagonally; arrow keys resize" : `Trim whitespace or scale at ${handle} edge; arrow keys resize`}
        className={`absolute z-10 ${position} touch-none appearance-none border-0 bg-transparent shadow-none outline-none hover:bg-ring/20 focus-visible:ring-2 focus-visible:ring-ring`}
        onPointerDown={event=>{
          const frame=frameBoundsRef.current,paint=paintBoundsRef.current,rect=frameRef.current?.getBoundingClientRect();
          if(event.button!==0 || resizeDrag.current || !frame || !paint || !rect)return;
          event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
          if(viewportRef.current)viewportRef.current.style.overflow="visible";
          resizeDrag.current={handle,pointerId:event.pointerId,x:event.clientX,y:event.clientY,frame:{...frame},paint:{...paint},scale:displayScale,rect};}}
        onPointerMove={event=>{
          const drag=resizeDrag.current;if(drag?.handle!==handle || drag.pointerId!==event.pointerId)return;
          changeFrame(handle,(event.clientX-drag.x)/drag.scale,(event.clientY-drag.y)/drag.scale,drag.frame,drag.paint);}}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        onKeyDown={event=>{
          const dx=({ArrowLeft:-12,ArrowRight:12} as Record<string,number>)[event.key];
          const dy=({ArrowUp:-12,ArrowDown:12} as Record<string,number>)[event.key];
          if(handle==="corner" ? dx===undefined && dy===undefined : horizontal ? dx===undefined : dy===undefined)return;
          event.preventDefault();changeFrame(handle,(dx??0)/displayScale,(dy??0)/displayScale,undefined,undefined,true);}}>
        {handle==="corner" && <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none size-full text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M5 16 16 5 M10 16 16 10 M15 16 16 15"/></svg>}
      </button>;
    })}
    </div>
    </div>
    <div ref={tooltipRef} role="tooltip" hidden={!hoverDescription}
      className="pointer-events-none fixed z-50 max-w-[min(340px,calc(100vw-24px))] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-snug text-popover-foreground shadow-md"
      style={{left:12,top:12}}>{hoverDescription}</div>
  </div>;
}
