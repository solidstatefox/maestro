"use client";
import { assign, createActor, fromPromise, setup } from "xstate";
import { validateCurrentHistoryQuery, type ValidatedHistoryQuery } from "@/lib/client-query-shacl";

type Context = { key:string; output:ValidatedHistoryQuery|null; error:string; historyId:string; queryXml:string };
type Event = {type:"VALIDATE";key:string;historyId:string;queryXml:string} | {type:"CLEAR"};
const empty=():Context=>({key:"",output:null,error:"",historyId:"",queryXml:""});
/** Validation is a prerequisite for ribbon provider discovery. Abort is owned by
 * the invoked XState actor, not a React timer or a second request controller. */
export const maestroQueryContextMachine=setup({
  types:{context:{} as Context,events:{} as Event},
  actors:{check:fromPromise(async ({input,signal}:{input:{historyId:string;queryXml:string};signal:AbortSignal})=>
    validateCurrentHistoryQuery(input.historyId,input.queryXml,signal))},
}).createMachine({
  id:"maestro-query-context",initial:"idle",context:empty,
  on:{CLEAR:{target:".idle",actions:assign(empty)},VALIDATE:{guard:({context,event})=>context.key!==event.key,target:".validating",reenter:true,actions:assign(({event})=>
    ({...empty(),key:event.key,historyId:event.historyId,queryXml:event.queryXml}))}},
  states:{
    idle:{},validating:{invoke:{src:"check",input:({context})=>({historyId:context.historyId,queryXml:context.queryXml}),
      onDone:[{guard:({event})=>event.output.report.conforms,target:"ready",actions:assign(({event})=>({output:event.output,error:""}))},
        {target:"blocked",actions:assign(({event})=>({output:event.output,error:""}))}],
      onError:{target:"failed",actions:assign(({event})=>({output:null,error:event.error instanceof Error?event.error.message:String(event.error)}))},
    }},ready:{},blocked:{},failed:{},
  },
});
const fresh=()=>createActor(maestroQueryContextMachine);
export function createMaestroQueryContextController(){
  let actor:ReturnType<typeof fresh>|null=null;let snapshot=fresh().getSnapshot();
  let sub:{unsubscribe():void}|null=null;const listeners=new Set<()=>void>();
  const publish=()=>{for(const cb of listeners)cb();};
  return {
    start(){if(actor)return;actor=fresh();sub=actor.subscribe(s=>{snapshot=s;publish();});actor.start();},
    stop(){sub?.unsubscribe();sub=null;actor?.stop();actor=null;snapshot=fresh().getSnapshot();publish();},
    validate(key:string,historyId:string,queryXml:string){actor?.send({type:"VALIDATE",key,historyId,queryXml});},
    clear(){actor?.send({type:"CLEAR"});},
    getSnapshot:()=>snapshot,
    subscribe(cb:()=>void){listeners.add(cb);return()=>{listeners.delete(cb);};},
  };
}
export function selectQueryContext(s:ReturnType<ReturnType<typeof createMaestroQueryContextController>["getSnapshot"]>,key:string){
  const matching=Boolean(key)&&s.context.key===key;
  const phase=matching?String(s.value):key?"waiting":"idle";
  return {phase,loading:phase==="waiting"||phase==="validating",ready:phase==="ready",
    report:matching?s.context.output?.report??null:null,
    matchedProviders:matching&&phase==="ready"?s.context.output?.queryProviders??[]:[],
    error:matching&&phase==="failed"?s.context.error:""};
}
