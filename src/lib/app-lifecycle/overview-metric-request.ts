
import { attributedSparqlFetch } from "@/lib/sparql-request-attribution";
/** Optional Virtuoso node-scoring request lifecycle. The machine owns the
 * request and cancels it on query changes, rerun, and view unmount. */
import {assign,createActor,fromPromise,setup} from "xstate";
import {makeNodeAnalyticsQuery,readNodeAnalytics,type NodeMetric,type EdgeDirection} from "@/lib/overview-node-metrics";

export type OverviewMetricRequest = {endpoint:string;uris:string[];predicate:string;metric:NodeMetric;graph?:string;direction:EdgeDirection;nativeEnabled:boolean};
export type OverviewMetricResult=ReturnType<typeof readNodeAnalytics>;
type Context={request:OverviewMetricRequest|null;result:OverviewMetricResult;error:string};
type Event={type:"RUN";request:OverviewMetricRequest}|{type:"RESET"};
const empty:Context={request:null,result:[],error:""};
const metricActor=fromPromise(async ({input,signal}:{input:OverviewMetricRequest;signal:AbortSignal})=>{
  const query=makeNodeAnalyticsQuery({uris:input.uris,predicate:input.predicate,metric:input.metric,graph:input.graph,direction:input.direction,nativeEnabled:input.nativeEnabled});
  if(!query || !/^https?:\/\//i.test(input.endpoint)) throw new Error("No valid node-analytics query is available for this scope.");
  const response=await attributedSparqlFetch("/proxy/api/sparql",{method:"POST",headers:{"x-maestro-debug-source":"urn:maestro:component:Overview:Metric","x-maestro-debug-component":"Overview:Metric","Content-Type":"application/json"},body:JSON.stringify({addr:`@${input.endpoint}`,query}),signal});
  if(!response.ok) throw new Error(`Node analytics returned HTTP ${response.status}.`);
  const json=await response.json();
  return readNodeAnalytics(json,input.metric==="wcc"||input.metric==="scc"||input.metric==="community"?120:30);
});
export const overviewMetricMachine=setup({
  types:{} as {context:Context;events:Event},actors:{runMetric:metricActor},
}).createMachine({id:"maestro-overview-node-metrics",initial:"idle",context:empty,
  on:{RESET:{target:".idle",actions:assign(()=>empty)},RUN:{target:".running",reenter:true,actions:assign(({event})=>({request:event.request,result:[],error:""}))}},
  states:{idle:{},running:{invoke:{src:"runMetric",input:({context})=>context.request!,
    onDone:{target:"complete",actions:assign(({event})=>({result:event.output,error:""}))},
    onError:{target:"failed",actions:assign(({event})=>({result:[],error:event.error instanceof Error?event.error.message:"Node analytics request failed."}))}}},
    complete:{},failed:{},
  },
});
export type OverviewMetricSnapshot=Readonly<{phase:"idle"|"running"|"complete"|"failed";result:OverviewMetricResult;error:string}>;
const initial:OverviewMetricSnapshot=Object.freeze({phase:"idle",result:[],error:""});
export function createOverviewMetricController(){
  type Actor=ReturnType<typeof createActor<typeof overviewMetricMachine>>;
  let actor:Actor|null=null;
  let subscription:{unsubscribe():void}|null=null;
  let snapshot:OverviewMetricSnapshot=initial;
  const listeners=new Set<()=>void>();
  const publish=()=>{
    if(!actor)return;
    const current=actor.getSnapshot();
    const next:OverviewMetricSnapshot={phase:current.value as OverviewMetricSnapshot["phase"],result:current.context.result,error:current.context.error};
    if(next.phase===snapshot.phase&&next.result===snapshot.result&&next.error===snapshot.error)return;
    snapshot=next;for(const listener of listeners)listener();
  };
  return {
    start(){if(actor)return;actor=createActor(overviewMetricMachine);subscription=actor.subscribe(publish);actor.start();publish();},
    stop(){subscription?.unsubscribe();subscription=null;actor?.stop();actor=null;snapshot=initial;for(const listener of listeners)listener();},
    run(request:OverviewMetricRequest){actor?.send({type:"RUN",request});},
    reset(){actor?.send({type:"RESET"});},
    getSnapshot:()=>snapshot,
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
  };
}
