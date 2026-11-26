import test from "node:test";
import assert from "node:assert/strict";
import {createProviderDiscoverySupervisor,type DiscoveryObservation} from "../src/lib/app-lifecycle/provider-discovery-supervisor";
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
async function until(predicate:()=>boolean){for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.fail("Discovery supervisor did not reach expected state.");}
test("supervisor invokes independent lanes, single-flights same key, retries only the failed lane and cancels pending work",async()=>{
 const c=createProviderDiscoverySupervisor<string>("test-supervisor");c.start();
 try{
  let population=0,contextual=0;
  const observation:DiscoveryObservation<string>={active:true,cancelled:false,population:{key:"p1",waiting:"",execute:async()=>{population++;return ["population"]; }},contextual:{key:"c1",waiting:"History",execute:async()=>{contextual++;if(contextual===1)throw new Error("failure");return ["contextual"];}}};
  c.observe(observation);await until(()=>c.getSnapshot().population.matches("ready")&&c.getSnapshot().contextual.matches("waiting"));
  assert.equal(population,1);assert.equal(contextual,0);
  c.observe(observation);await tick();assert.equal(population,1);
  const ready={...observation,contextual:{...observation.contextual,waiting:""}};c.observe(ready);await until(()=>c.getSnapshot().contextual.matches("failed"));assert.equal(population,1);
  c.retry();await until(()=>c.getSnapshot().contextual.matches("ready"));assert.equal(contextual,2);assert.equal(population,1);
  let aborted=false;const pending={...ready,population:{key:"p2",waiting:"",execute:(signal:AbortSignal)=>new Promise<string[]>((resolve,reject)=>{signal.addEventListener("abort",()=>{aborted=true;reject(signal.reason);},{once:true});})}};
  c.observe(pending);await until(()=>c.getSnapshot().population.matches("loading"));c.cancel();await until(()=>c.getSnapshot().population.matches("cancelled"));assert.ok(aborted);
  assert.deepEqual(c.getSnapshot().contextual.context.items,[]);
 }finally{c.stop();}
});
