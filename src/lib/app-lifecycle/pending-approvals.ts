"use client";
/** Canvas-context pending approval counter. XState owns the scoped discovery
 * set, effective-approval lookup, request cancellation, and badge lifecycle.
 * SHACL applicability is established by the existing caller's discovery
 * workflow; this actor NEVER treats mere catalog membership as a match. */
import { runActorQuery } from "./actor-query-authority";
import { assign, createActor, fromPromise, setup } from "xstate";
import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { readClientPolicyApprovals, type ClientApproval } from "@/lib/client-policy-approvals";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";

const safe=(uri:string)=>uri.length>0&&uri.length<=4096&&/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(uri);
const scopeFor=(queryXml:string,record="")=>{
  if (!queryXml || queryXml.length>200_000) return "";
  return `${canonicalQueryIdentityXml(queryXml)}\u0000${record}`;
};
type Context={activeQuery:string;activeRecord:string;matches:Record<string,string[]>;
  approvals:ClientApproval[];error:string};
type Event={type:"ACTIVATE";query:string;record:string}|{type:"MATCH";query:string;record:string;uris:string[]}
  |{type:"REFRESH"}|{type:"CLEAR"};
const empty=():Context=>({activeQuery:"",activeRecord:"",matches:{},approvals:[],error:""});
function activeMatches(context:Context):string[]{
  if(!context.activeQuery)return [];
  const scoped=context.matches[context.activeQuery]??[];
  const record=context.activeRecord?context.matches[`${context.activeQuery}\u0000${context.activeRecord}`]??[]:[];
  return [...new Set([...scoped,...record])].slice(0,500);
}
function register(context:Context,event:Extract<Event,{type:"MATCH"}>):Context {
  const key=event.record?`${event.query}\u0000${event.record}`:event.query;
  if(!event.query)return context;
  const before=context.matches[key]??[];
  const combined=[...new Set([...before,...event.uris.filter(safe)])].slice(0,500);
  if(combined.length===before.length)return context;
  const matches={...context.matches,[key]:combined};
  // Keep recent scoped matches bounded; old query matches must never inflate
  // the badge for the *current* live query or Record.
  const keys=Object.keys(matches);
  for(const stale of keys.slice(0,Math.max(0,keys.length-30)))delete matches[stale];
  return {...context,matches,error:""};
}
const machine=setup({
  types:{context:{} as Context,events:{} as Event},
  actors:{check:fromPromise(async ({input,signal}:{input:{uris:string[]};signal:AbortSignal})=>
    runActorQuery("pending-approvals",signal,owned=>readClientPolicyApprovals(input.uris,owned)))},
}).createMachine({
  id:"maestro-view-pending-approvals",initial:"idle",context:empty,
  on:{
    CLEAR:{target:".idle",actions:assign(empty)},
    ACTIVATE:{target:".checking",actions:assign(({context,event})=>({
      activeQuery:event.query,activeRecord:event.record,error:"",
    }))},
    MATCH:[
      {guard:({context,event})=>event.query===context.activeQuery &&
        event.uris.some(uri=>!(context.matches[event.record?`${event.query}\u0000${event.record}`:event.query]??[]).includes(uri)),
        target:".checking",actions:assign(({context,event})=>register(context,event))},
      {actions:assign(({context,event})=>register(context,event))},
    ],
    REFRESH:{target:".checking",actions:assign({error:""})},
  },
  states:{
    idle:{},
    checking:{always:{guard:({context})=>activeMatches(context).length===0,target:"ready"},
      invoke:{src:"check",input:({context})=>({uris:activeMatches(context)}),
        onDone:{target:"ready",actions:assign(({event})=>({approvals:event.output,error:""}))},
        onError:{target:"failed",actions:assign(({event})=>({error:event.error instanceof Error?event.error.message:String(event.error)}))},
      }},
    ready:{},failed:{},
  },
});
const pendingActor=createActor(machine);
let started=false,activeQuery="",activeRecord="";
function start(){if(!started){pendingActor.start();started=true;}}
export const pendingApprovalController={
  subscribe(listener:()=>void){start();const subscription=pendingActor.subscribe(listener);return()=>subscription.unsubscribe();},
  getSnapshot:()=>{start();return pendingActor.getSnapshot();},
  activate(queryXml:string,recordUri=""){
    start();const query=scopeFor(queryXml);const record=safe(recordUri)?recordUri:"";
    // A View/Analyze provider query is a projection of the Browse context, not
    // a user dismissal of its pending provider approvals.
    if(/\bsrc=["']urn:maestro:providers:/.test(queryXml))return;
    if(query===activeQuery&&record===activeRecord)return;
    activeQuery=query;activeRecord=record;
    pendingActor.send({type:"ACTIVATE",query,record});
  },
  match(queryXml:string,uris:string[],recordUri=""){
    start();const query=scopeFor(queryXml);
    if(!query||!uris.some(safe))return;
    pendingActor.send({type:"MATCH",query,record:safe(recordUri)?recordUri:"",uris:uris.filter(safe)});
  },
  refresh(){start();pendingActor.send({type:"REFRESH"});},
  clear(){start();activeQuery="";activeRecord="";pendingActor.send({type:"CLEAR"});},
};
export function selectPendingApprovalBadge(snapshot:ReturnType<typeof pendingActor.getSnapshot>){
  // The last authoritative approval projection remains visible while a fresh
  // match or revocation check is pending; clicking View is not an ACK event.
  const approvals=snapshot.context.approvals;
  const pending=approvals.filter(item=>item.status==="Pending");
  const policies=pending.filter(item=>item.category==="Policy").length;
  const providers=pending.filter(item=>item.category==="Provider").length;
  const providersByKind:Record<ProviderKind,number> = {
    policies:0,formats:0,transcoders:0,"facet-widgets":0,curators:0,
    "fsm-providers":0,kinds:0,perspectives:0,"analysis-providers":0,
  };
  for(const item of pending)if(item.providerKind)providersByKind[item.providerKind]++;
  // Total is defined by actual ribbon populations. An unidentified provider
  // cannot be silently allocated to an unrelated button.
  return {total:Object.values(providersByKind).reduce((a,b)=>a+b,0),policies,providers,providersByKind,
    unmatched:pending.filter(item=>!item.providerKind).length,
    loading:snapshot.matches("checking"),error:snapshot.matches("failed")?snapshot.context.error:""};
}
