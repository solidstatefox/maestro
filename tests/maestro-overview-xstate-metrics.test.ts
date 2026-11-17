import {test} from "node:test";
import assert from "node:assert/strict";
import {createOverviewMetricController} from "../src/lib/app-lifecycle/overview-metric-request";

const input={endpoint:"https://example.org/sparql",uris:["https://example.org/a","https://example.org/b"],predicate:"https://example.org/knows",metric:"degree" as const,direction:"property" as const,nativeEnabled:false};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("metric XState actor aborts replaced requests, RESET and unmount",async()=>{
  const originalFetch=globalThis.fetch;
  const signals:AbortSignal[]=[];
  globalThis.fetch=(async (_url:unknown,options?:RequestInit)=>{
    const signal=options?.signal as AbortSignal;signals.push(signal);
    return await new Promise<Response>((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new DOMException("Cancelled","AbortError")),{once:true}));
  }) as typeof fetch;
  try{
    const c=createOverviewMetricController();c.start();
    c.run(input);await tick();assert.equal(c.getSnapshot().phase,"running");
    c.run({...input,predicate:"https://example.org/wrote"});await tick();
    assert.equal(signals[0].aborted,true);
    c.reset();await tick();assert.equal(signals[1].aborted,true);
    assert.equal(c.getSnapshot().phase,"idle");
    c.run(input);await tick();c.stop();assert.equal(signals[2].aborted,true);
    c.start();assert.equal(c.getSnapshot().phase,"idle");c.stop();
  }finally{globalThis.fetch=originalFetch;}
});
test("metric XState actor returns zero-degree members instead of dropping them",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      results: { bindings: [
        { node: { value: "https://example.org/a" }, score: { value: "0" } },
        { node: { value: "https://example.org/b" }, score: { value: "1" } },
      ] },
    }),
  } as Response)) as typeof fetch;
  try{
    const c=createOverviewMetricController();c.start();c.run(input);await tick();await tick();
    assert.equal(c.getSnapshot().phase,"complete");
    assert.deepEqual(c.getSnapshot().result.map(x=>[x.uri,x.score]),[["https://example.org/b",1],["https://example.org/a",0]]);
    c.stop();
  }finally{globalThis.fetch=originalFetch;}
});
