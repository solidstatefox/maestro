"use client";
import { assign, createActor, fromPromise, setup } from "xstate";
import type { ShaclValidationReport } from "../shacl-validation-report";
import { QUERY_OPERATION_WATCHDOG_MS } from "../virtuoso-anytime";
import type { ProviderPolicyRows } from "../client-provider-validation";
import type { ProviderPageProgram } from "../provider-page-program";

export type ProviderValidationInput = { prepare:(signal:AbortSignal)=>Promise<ProviderPageProgram>; load:(signal:AbortSignal)=>Promise<ProviderPolicyRows>; validate:(program:ProviderPageProgram,policy:ProviderPolicyRows,signal:AbortSignal)=>Promise<ShaclValidationReport> };
type Context={key:string;input:ProviderValidationInput|null;program:ProviderPageProgram|null;policy:ProviderPolicyRows;report:ShaclValidationReport|null;error:string};
type Event={type:"VALIDATE";key:string;input:ProviderValidationInput}|{type:"CANCEL"};
const empty=():Context=>({key:"",input:null,program:null,policy:[],report:null,error:""});
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
export const maestroProviderValidationMachine=setup({
 types:{context:{} as Context,events:{} as Event},
 actors:{
  prepare:fromPromise(async({input,signal}:{input:ProviderValidationInput;signal:AbortSignal})=>input.prepare(signal)),
  loadPolicy:fromPromise(async({input,signal}:{input:ProviderValidationInput;signal:AbortSignal})=>input.load(signal)),
  validateData:fromPromise(async({input,signal}:{input:{run:ProviderValidationInput;program:ProviderPageProgram;policy:ProviderPolicyRows};signal:AbortSignal})=>input.run.validate(input.program,input.policy,signal)),
 },
}).createMachine({
 id:"maestro-provider-validation",initial:"idle",context:empty,
 on:{VALIDATE:{guard:({context,event})=>context.key!==event.key,target:".preparing",reenter:true,actions:assign(({event})=>({...empty(),key:event.key,input:event.input}))},CANCEL:{target:".cancelled",actions:assign(empty)}},
 states:{
  idle:{},cancelled:{},
  preparing:{invoke:{src:"prepare",input:({context})=>context.input!,onDone:[
   {guard:({event})=>event.output.data.focus.length===0,target:"empty",actions:assign(({event})=>({program:event.output,input:null}))},
   {target:"loadingPolicy",actions:assign(({event})=>({program:event.output}))},
  ],onError:{target:"failed",actions:assign(({event})=>({error:message(event.error),input:null}))}},after:{30000:{target:"timedOut",actions:assign({error:"Provider page preparation timed out.",input:null})}}},
  loadingPolicy:{invoke:{src:"loadPolicy",input:({context})=>context.input!,onDone:{target:"validating",actions:assign(({event})=>({policy:event.output}))},onError:{target:"failed",actions:assign(({event})=>({error:message(event.error),input:null}))}},after:{[QUERY_OPERATION_WATCHDOG_MS]:{target:"timedOut",actions:assign({error:"Provider policy retrieval exceeded the local liveness watchdog.",input:null})}}},
  validating:{invoke:{src:"validateData",input:({context})=>({run:context.input!,program:context.program!,policy:context.policy}),onDone:[
   {guard:({event})=>event.output.complete&&event.output.conforms,target:"ready",actions:assign(({event})=>({report:event.output,input:null,policy:[]}))},
   {target:"invalid",actions:assign(({event})=>({report:event.output,input:null,policy:[]}))},
  ],onError:{target:"failed",actions:assign(({event})=>({error:message(event.error),input:null,policy:[]}))}},after:{30000:{target:"timedOut",actions:assign({error:"Provider local SHACL validation timed out.",input:null,policy:[]})}}},
  ready:{},empty:{},invalid:{},failed:{},timedOut:{},
 },
});
const fresh=()=>createActor(maestroProviderValidationMachine);
export function createMaestroProviderValidationController(){
 let actor:ReturnType<typeof fresh>|null=null;
 let snapshot=fresh().getSnapshot();let sub:{unsubscribe():void}|undefined;
 const listeners=new Set<()=>void>();const publish=()=>{for(const cb of listeners)cb();};
 return {start(){if(actor)return;actor=fresh();sub=actor.subscribe(s=>{snapshot=s;publish();});actor.start();},stop(){sub?.unsubscribe();sub=undefined;actor?.stop();actor=null;snapshot=fresh().getSnapshot();publish();},validate(key:string,input:ProviderValidationInput){actor?.send({type:"VALIDATE",key,input});},cancel(){actor?.send({type:"CANCEL"});},getSnapshot:()=>snapshot,subscribe(cb:()=>void){listeners.add(cb);return()=>{listeners.delete(cb);};}};
}
export function selectProviderValidation(s:ReturnType<ReturnType<typeof createMaestroProviderValidationController>["getSnapshot"]>,key:string){
 const same=Boolean(key)&&s.context.key===key;
 return {phase:same?String(s.value):"idle",program:same?s.context.program:null,report:same?s.context.report:null,error:same?s.context.error:""};
}
