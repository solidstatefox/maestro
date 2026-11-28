import test from "node:test";
import assert from "node:assert/strict";
import { createActor, SimulatedClock } from "xstate";
import { facetProviderQueueMachine, facetProviderProgressMachine, FACET_PROVIDER_FRAME_MS, FACET_PROVIDER_FRAMES, createFacetProviderProgressController, type FacetProviderProgressInput } from "../src/lib/app-lifecycle/facet-provider-progress";
import { createMaestroProviderDiscoveryController } from "../src/lib/app-lifecycle/providers";

const input = (overrides: Partial<FacetProviderProgressInput> = {}): FacetProviderProgressInput => ({
  attempt:"1", queued:true, discovering:true, enabled:true, renderer:"", waitingForData:false, ...overrides,
});
test("queue observation is invocation-scoped and cannot be rearmed by an old request", () => {
  const actor=createActor(facetProviderQueueMachine); actor.start();
  try {
    actor.send({type:"BEGIN",key:"query-a"}); assert.ok(actor.getSnapshot().matches("waiting"));
    const first=actor.getSnapshot().context.run;
    actor.send({type:"ADMITTED",run:first}); assert.ok(actor.getSnapshot().matches("queued"));
    actor.send({type:"BEGIN",key:"query-b"}); const second=actor.getSnapshot().context.run;
    actor.send({type:"ADMITTED",run:first}); actor.send({type:"END",run:first});
    assert.ok(actor.getSnapshot().matches("waiting"));
    actor.send({type:"ADMITTED",run:second}); assert.ok(actor.getSnapshot().matches("queued"));
    actor.send({type:"END",run:second}); actor.send({type:"ADMITTED",run:second}); assert.ok(actor.getSnapshot().matches("idle"));
  } finally {actor.stop();}
});
test("eight exact frames cycle every 150ms only after queue admission", () => {
  const clock=new SimulatedClock();const actor=createActor(facetProviderProgressMachine,{clock});actor.start();
  try {
    actor.send({type:"SYNC",input:input({queued:false})});clock.increment(2000);assert.ok(actor.getSnapshot().matches("idle"));
    actor.send({type:"SYNC",input:input()});assert.ok(actor.getSnapshot().matches("animating"));
    assert.equal(actor.getSnapshot().context.frame,0);
    clock.increment(FACET_PROVIDER_FRAME_MS-1);assert.equal(actor.getSnapshot().context.frame,0);
    clock.increment(1);assert.equal(actor.getSnapshot().context.frame,1);
    for(let i=2;i<=8;i++){clock.increment(FACET_PROVIDER_FRAME_MS);assert.equal(actor.getSnapshot().context.frame,i%8);}
    assert.equal(FACET_PROVIDER_FRAME_MS,150);assert.equal(FACET_PROVIDER_FRAMES.length,8);
    assert.deepEqual(FACET_PROVIDER_FRAMES.map(f=>f.layers.map(layer=>layer.icon).join("+")),["sparkle","sparkles","sparkles","sparkle","sparkles","sparkles","sparkle","sparkles+sparkles"]);
    assert.equal(FACET_PROVIDER_FRAMES[2].layers[0].transform,"matrix(0,1,1,0,0,0)");
    assert.equal(FACET_PROVIDER_FRAMES[4].layers[0].transform,"scaleX(-1)");
    assert.equal(FACET_PROVIDER_FRAMES[5].layers[0].transform,"matrix(0,-1,-1,0,0,0)");
    assert.equal(FACET_PROVIDER_FRAMES[6].layers[0].transform,"none");
    assert.deepEqual(FACET_PROVIDER_FRAMES[7].layers.map(layer=>layer.transform),["none","scaleX(-1)"]);
  } finally {actor.stop();}
});
test("lookup -> approval -> renderer commit is continuous; old renders and skeletons cannot complete it",()=>{
  const clock=new SimulatedClock();const actor=createActor(facetProviderProgressMachine,{clock});actor.start();
  try {
    actor.send({type:"SYNC",input:input()});clock.increment(300);
    actor.send({type:"SYNC",input:input({discovering:false,renderer:"a/provider",waitingForData:true})});
    assert.ok(actor.getSnapshot().matches("animating"));
    actor.send({type:"RENDER",identity:"old/provider",ready:true});assert.ok(actor.getSnapshot().matches("animating"));
    actor.send({type:"RENDER",identity:"a/provider",ready:true});assert.ok(actor.getSnapshot().matches("animating"));
    actor.send({type:"SYNC",input:input({discovering:false,renderer:"a/provider"})});assert.ok(actor.getSnapshot().matches("idle"));
    clock.increment(3000);assert.equal(actor.getSnapshot().context.frame,0);
    // Changing presentation locally or observing the same completed attempt does not resurrect a query animation.
    actor.send({type:"SYNC",input:input({discovering:false,renderer:"other/provider"})});assert.ok(actor.getSnapshot().matches("idle"));
    actor.send({type:"SYNC",input:input({attempt:"2",renderer:"b/provider"})});assert.ok(actor.getSnapshot().matches("animating"));
    actor.send({type:"RENDER",identity:"b/provider",ready:true});assert.ok(actor.getSnapshot().matches("animating"),"retained renderer does not complete a new discovery");
    actor.send({type:"SYNC",input:input({attempt:"2",discovering:false,renderer:"b/provider"})});assert.ok(actor.getSnapshot().matches("idle"));
  } finally {actor.stop();}
});
test("batched Personal facets settle independently, including an early Tag Cloud, no match and cancellation",()=>{
  const tag=createActor(facetProviderProgressMachine),ordinary=createActor(facetProviderProgressMachine);tag.start();ordinary.start();
  try {
    for(const actor of [tag,ordinary])actor.send({type:"SYNC",input:input()});
    tag.send({type:"RENDER",identity:"tag",ready:true}); // child commit may precede parent layout observation
    tag.send({type:"SYNC",input:input({discovering:false,renderer:"tag"})});
    assert.ok(tag.getSnapshot().matches("idle"));assert.ok(ordinary.getSnapshot().matches("animating"));
    ordinary.send({type:"SYNC",input:input({discovering:false})});assert.ok(ordinary.getSnapshot().matches("idle"));
    ordinary.send({type:"SYNC",input:input({attempt:"2"})});assert.ok(ordinary.getSnapshot().matches("animating"));
    ordinary.send({type:"SYNC",input:input({attempt:"2",enabled:false})});assert.ok(ordinary.getSnapshot().matches("idle"));
    ordinary.send({type:"SYNC",input:input({attempt:"2"})});assert.ok(ordinary.getSnapshot().matches("idle"));
  }finally{tag.stop();ordinary.stop();}
});
test("Strict Mode stop/start creates a fresh frame actor; tag resolution belongs to the exact discovery",()=>{
  const progress=createFacetProviderProgressController();progress.start();
  progress.send({type:"SYNC",input:input()});assert.ok(progress.getSnapshot().matches("animating"));
  progress.stop();assert.ok(progress.getSnapshot().matches("idle"));progress.start();assert.ok(progress.getSnapshot().matches("idle"));progress.stop();
  const discovery=createMaestroProviderDiscoveryController();discovery.start();
  try {
    discovery.send({type:"DISCOVERY_STARTED",requestKey:"a",applicabilityKey:"p",evidenceKey:"{}"});
    discovery.send({type:"DISCOVERY_TAGS_RESOLVED",requestKey:"a",tags:[]});assert.equal(discovery.getSnapshot().context.tagsResolved,true);
    discovery.send({type:"DISCOVERY_STARTED",requestKey:"b",applicabilityKey:"p",evidenceKey:"{}"});
    discovery.send({type:"DISCOVERY_TAGS_RESOLVED",requestKey:"a",tags:[]});assert.equal(discovery.getSnapshot().context.tagsResolved,false);
  } finally{discovery.stop();}
});
