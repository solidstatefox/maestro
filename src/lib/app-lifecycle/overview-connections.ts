/** Actor-owned request lifecycle: replacing a request, scope reset, and
 * unmount each stop the invoked promise actor and abort its fetch signal. */
import { assign, createActor, fromPromise, setup } from "xstate";
import { findOverviewConnections, type ConnectionInput, type ConnectionPath } from "@/lib/overview-connection-path";

type Context={input:ConnectionInput|null;paths:ConnectionPath[];error:string};
type Event={type:"FIND";input:ConnectionInput}|{type:"RESET"};
const initial:Context={input:null,paths:[],error:""};
export const overviewConnectionMachine = setup({
  types:{context:{} as Context,events:{} as Event},
  actors:{findPaths:fromPromise(async ({input,signal}:{input:ConnectionInput;signal:AbortSignal})=>findOverviewConnections(input,signal))},
}).createMachine({
  id:"maestro-overview-find-connections",initial:"idle",context:initial,
  on:{RESET:{target:".idle",actions:assign(()=>initial)},FIND:{target:".finding",reenter:true,actions:assign(({event})=>({input:event.input,paths:[],error:""}))}},
  states:{
    idle:{},
    finding:{invoke:{src:"findPaths",input:({context})=>context.input!,
      onDone:{target:"complete",actions:assign(({event})=>({paths:event.output,error:""}))},
      onError:{target:"failed",actions:assign(({event})=>({paths:[],error:event.error instanceof Error?event.error.message:"Connection search failed."}))},
    }},
    complete:{},failed:{},
  },
});
export type OverviewConnectionSnapshot=Readonly<{phase:"idle"|"finding"|"complete"|"failed";paths:ConnectionPath[];error:string}>;
const empty:OverviewConnectionSnapshot=Object.freeze({phase:"idle",paths:[],error:""});
export function createOverviewConnectionsController(){
  let actor:ReturnType<typeof createActor<typeof overviewConnectionMachine>>|null=null;
  let subscription:{unsubscribe():void}|null=null;
  let snapshot=empty;
  const listeners=new Set<()=>void>();
  const publish=()=>{
    const current=actor?.getSnapshot();
    if(!current)return;
    const next:OverviewConnectionSnapshot={phase:current.value as OverviewConnectionSnapshot["phase"],paths:current.context.paths,error:current.context.error};
    if(next.phase===snapshot.phase&&next.paths===snapshot.paths&&next.error===snapshot.error)return;
    snapshot=next;for(const listener of listeners)listener();
  };
  return {
    start(){if(actor)return;actor=createActor(overviewConnectionMachine);subscription=actor.subscribe(publish);actor.start();publish();},
    stop(){subscription?.unsubscribe();subscription=null;actor?.stop();actor=null;snapshot=empty;for(const listener of listeners)listener();},
    find(input:ConnectionInput){actor?.send({type:"FIND",input});},
    reset(){actor?.send({type:"RESET"});},
    getSnapshot:()=>snapshot,
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
  };
}
