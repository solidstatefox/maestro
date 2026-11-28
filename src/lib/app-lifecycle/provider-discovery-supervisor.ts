import { assign, createActor, sendTo, setup, type SnapshotFrom } from "xstate";
import { makeDiscoveryMachine, type DiscoveryEvent, type DiscoveryExecutor } from "./view-discovery";

/** Observations carry evidence, not start/cancel commands from React. Each
 * lane can advance independently. The supervisor owns child actor lifetime. */
export type DiscoveryLaneInput<T> = {key:string;waiting:string;execute:DiscoveryExecutor<T>};
export type DiscoveryObservation<T> = {active:boolean;cancelled:boolean;population:DiscoveryLaneInput<T>;contextual:DiscoveryLaneInput<T>};
export function discoveryLaneEvent<T>(observation:DiscoveryObservation<T>,lane:"population"|"contextual"):DiscoveryEvent<T>{
  if(observation.cancelled)return {type:"CANCEL"};
  if(!observation.active)return {type:"INACTIVE"};
  const scope=observation[lane];
  return scope.waiting?{type:"WAIT",key:scope.key,reason:scope.waiting}:{type:"DISCOVER",key:scope.key,execute:scope.execute};
}
export function createProviderDiscoverySupervisor<T>(id:string){
  const lane=makeDiscoveryMachine<T>(`${id}-lane`, "analysis-discovery");
  type LaneSnapshot=SnapshotFrom<typeof lane>;
  type Context={population:LaneSnapshot;contextual:LaneSnapshot};
  type Event={type:"OBSERVE";observation:DiscoveryObservation<T>}|{type:"CANCEL"}|{type:"RETRY"};
  const initialLane=()=>createActor(lane).getSnapshot();
  const initial=():Context=>({population:initialLane(),contextual:initialLane()});
  const machine=setup({
    types:{context:{} as Context,events:{} as Event},actors:{lane},
  }).createMachine({
    id,context:initial,initial:"active",
    states:{active:{
      invoke:[
        {id:"population",src:"lane",onSnapshot:{actions:assign({population:({event})=>event.snapshot as LaneSnapshot})}},
        {id:"contextual",src:"lane",onSnapshot:{actions:assign({contextual:({event})=>event.snapshot as LaneSnapshot})}},
      ],
      on:{
        OBSERVE:{actions:[sendTo("population",({event})=>discoveryLaneEvent(event.observation,"population")),sendTo("contextual",({event})=>discoveryLaneEvent(event.observation,"contextual"))]},
        CANCEL:{actions:[sendTo("population",{type:"CANCEL"}),sendTo("contextual",{type:"CANCEL"})]},
        RETRY:{actions:[sendTo("population",{type:"RETRY"}),sendTo("contextual",{type:"RETRY"})]},
      },
    }},
  });
  const fresh=()=>createActor(machine);
  let actor:ReturnType<typeof fresh>|null=null;
  let subscription:{unsubscribe():void}|null=null;
  let snapshot=initial();
  const listeners=new Set<()=>void>();
  const publish=(next:Context)=>{if(next===snapshot)return;snapshot=next;for(const cb of listeners)cb();};
  return {
    start(){if(actor)return;actor=fresh();subscription=actor.subscribe(state=>publish(state.context));actor.start();},
    stop(){subscription?.unsubscribe();subscription=null;actor?.stop();actor=null;publish(initial());},
    observe(observation:DiscoveryObservation<T>){actor?.send({type:"OBSERVE",observation});},
    cancel(){actor?.send({type:"CANCEL"});},retry(){actor?.send({type:"RETRY"});},
    getSnapshot:()=>snapshot,subscribe(cb:()=>void){listeners.add(cb);return()=>listeners.delete(cb);},
  };
}
