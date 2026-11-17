import {test} from "node:test";
import assert from "node:assert/strict";
import {createOverviewConnectionsController} from "../src/lib/app-lifecycle/overview-connections";
import {createOverviewAnalyticsCapabilityController} from "../src/lib/app-lifecycle/overview-analytics";

const uri=(s:string)=>`https://example.org/${s}`;
const input={source:uri("a"),target:uri("b"),endpoint:"https://example.org/sparql",maxHops:2};
const response=(bindings:unknown[]=[])=>({ok:true,json:async()=>({results:{bindings}})});
const wait=()=>new Promise(resolve=>setImmediate(resolve));

test("XState connection actor aborts a previous FIND, RESET, stop, and supports restart",async()=>{
  const originalFetch=globalThis.fetch;
  const signals:AbortSignal[]=[];
  globalThis.fetch=(async (_:unknown,options?:RequestInit)=>{
    const signal=options?.signal as AbortSignal;
    signals.push(signal);
    return await new Promise((resolve,reject)=>{
      signal?.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
    });
  }) as typeof globalThis.fetch;
  try {
    const controller=createOverviewConnectionsController();controller.start();
    controller.find(input);await wait();
    assert.equal(controller.getSnapshot().phase,"finding");
    controller.find({...input,target:uri("c")});await wait();
    assert.equal(signals[0]?.aborted,true);
    assert.equal(signals[1]?.aborted,false);
    controller.reset();await wait();
    assert.equal(signals[1]?.aborted,true);
    assert.equal(controller.getSnapshot().phase,"idle");
    controller.find(input);await wait();controller.stop();
    assert.equal(signals[2]?.aborted,true);
    controller.start();assert.equal(controller.getSnapshot().phase,"idle");controller.stop();
  } finally {globalThis.fetch=originalFetch;}
});

test("XState capability actor rejects stale server events and is reset on stop",()=>{
  const c=createOverviewAnalyticsCapabilityController();c.start();
  c.send({type:"CHECK",endpoint:uri("server-a")});
  c.send({type:"CHECK",endpoint:uri("server-b")});
  c.send({type:"RESOLVED",endpoint:uri("server-a"),capabilities:{product:"Virtuoso",version:"07.20.3243",bi:true,native:false,reason:"ok"}});
  assert.equal(c.getSnapshot().value,"checking");
  c.send({type:"RESOLVED",endpoint:uri("server-b"),capabilities:{product:"Virtuoso",version:"07.20.3243",bi:true,native:false,reason:"ok"}});
  assert.equal(c.getSnapshot().value,"available");
  c.stop();c.start();assert.equal(c.getSnapshot().value,"idle");c.stop();
});
