/** Capability gating for optional Virtuoso node analytics. The XState
 * invoked probe owns and aborts its transport on an endpoint change or reset.
 * Unknown servers cannot dispatch Virtuoso graph analytics requests. */
import { assign, createActor, fromPromise, setup } from "xstate";
import { virtuosoAnalyticsCapabilities, type AnalyticsCapabilities } from "@/lib/overview-node-metrics";
import { graphServerSoftware } from "@/lib/server-metadata";

export type CapabilityEvent =
  | { type:"CHECK"; endpoint:string }
  | { type:"RESOLVED"; endpoint:string; capabilities:AnalyticsCapabilities }
  | { type:"FAILED"; endpoint:string; message:string }
  | { type:"NATIVE_UNSUPPORTED"; endpoint:string }
  | { type:"RESET" };
type CapabilityContext = { endpoint:string; capabilities:AnalyticsCapabilities|null; error:string };
export const overviewAnalyticsCapabilityMachine = setup({
  types:{} as {context:CapabilityContext;events:CapabilityEvent},
  actors:{probe:fromPromise(async ({input,signal}:{input:{endpoint:string};signal:AbortSignal})=>{
    const {product,version}=await graphServerSoftware(input.endpoint,signal);
    return {endpoint:input.endpoint,capabilities:virtuosoAnalyticsCapabilities(product,version)};
  })},
}).createMachine({
  id:"overview-virtuoso-analytics-capability", initial:"idle",
  context:{endpoint:"",capabilities:null,error:""},
  on:{RESET:{target:".idle",actions:assign({endpoint:"",capabilities:null,error:""})}},
  states:{
    idle:{on:{CHECK:{target:"checking",actions:assign({endpoint:({event})=>event.endpoint,capabilities:null,error:""})}}},
    checking:{
      // Changing the endpoint re-enters checking: XState stops the old invoked
      // fetch actor and aborts its signal, never applying its late result.
      invoke:{src:"probe",input:({context})=>({endpoint:context.endpoint}),
        onDone:[
          {guard:({context,event})=>event.output.endpoint===context.endpoint&&event.output.capabilities.bi,target:"available",actions:assign({capabilities:({event})=>event.output.capabilities,error:""})},
          {guard:({context,event})=>event.output.endpoint===context.endpoint,target:"unsupported",actions:assign({capabilities:({event})=>event.output.capabilities,error:""})},
        ],
        onError:{target:"unavailable",actions:assign({capabilities:null,error:({event})=>event.error instanceof Error?event.error.message:"Server version detection failed."})},
      },
      on:{
        CHECK:{target:"checking",reenter:true,actions:assign({endpoint:({event})=>event.endpoint,capabilities:null,error:""})},
        // These explicit events remain for the existing diagnostic transition
        // tests and can be used by a provider-specific version override.
        RESOLVED:[
          {guard:({context,event})=>event.endpoint===context.endpoint && event.capabilities.bi,target:"available",actions:assign({capabilities:({event})=>event.capabilities,error:""})},
          {guard:({context,event})=>event.endpoint===context.endpoint,target:"unsupported",actions:assign({capabilities:({event})=>event.capabilities,error:""})},
        ],
        FAILED:{guard:({context,event})=>event.endpoint===context.endpoint,target:"unavailable",actions:assign({capabilities:null,error:({event})=>event.message})},
      },
    },
    available:{on:{CHECK:{target:"checking",actions:assign({endpoint:({event})=>event.endpoint,capabilities:null,error:""})},NATIVE_UNSUPPORTED:{guard:({context,event})=>event.endpoint===context.endpoint,actions:assign({capabilities:({context})=>context.capabilities?{...context.capabilities,native:false,reason:"Native bif: analytics was rejected by this server; SPARQL-BI degree analysis remains available."}:null})}}},
    unsupported:{on:{CHECK:{target:"checking",actions:assign({endpoint:({event})=>event.endpoint,capabilities:null,error:""})}}},
    unavailable:{on:{CHECK:{target:"checking",actions:assign({endpoint:({event})=>event.endpoint,capabilities:null,error:""})}}},
  },
});

/** StrictMode-safe per-view actor. Avoid retaining a started XState actor after
 * the View/Overview subtree unmounts; a remount creates a fresh machine. */
export function createOverviewAnalyticsCapabilityController() {
  type Actor = ReturnType<typeof createActor<typeof overviewAnalyticsCapabilityMachine>>;
  let actor:Actor|null=null;
  let subscription:{unsubscribe():void}|null=null;
  const initialSnapshot=createActor(overviewAnalyticsCapabilityMachine).getSnapshot();
  let snapshot=initialSnapshot;
  const listeners=new Set<()=>void>();
  const publish=()=>{for(const listener of listeners)listener();};
  return {
    start(){
      if(actor)return;
      actor=createActor(overviewAnalyticsCapabilityMachine);
      subscription=actor.subscribe(next=>{snapshot=next;publish();});
      actor.start();snapshot=actor.getSnapshot();publish();
    },
    stop(){
      subscription?.unsubscribe();subscription=null;
      actor?.stop();actor=null;snapshot=initialSnapshot;publish();
    },
    send(event:CapabilityEvent){actor?.send(event);},
    getSnapshot:()=>snapshot,
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
  };
}
