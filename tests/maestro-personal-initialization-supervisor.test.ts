import { test } from "node:test";
import assert from "node:assert/strict";
import { createPersonalInitializationController } from "../src/lib/app-lifecycle/personal-initialization-machine";
import { createMaestroAccessController, selectMaestroCapabilities } from "../src/lib/app-lifecycle/access";

test("replacing an in-flight seed aborts it and starts a distinct authenticated initialization", async () => {
  const controller=createPersonalInitializationController();controller.start();
  let oldSignal:AbortSignal|undefined;
  let started=()=>{};
  const firstStarted=new Promise<void>(resolve=>{started=resolve;});
  const first=controller.run("same-session",async ({signal})=>{
    oldSignal=signal;started();
    await new Promise<void>(resolve=>signal.addEventListener("abort",()=>resolve(),{once:true}));
    throw new Error("late aborted seed result");
  });
  await firstStarted;
  let replacementSignal:AbortSignal|undefined;
  const second=controller.run("same-session",async ({signal})=>{replacementSignal=signal;return true;});
  assert.equal(await first,false);
  assert.equal(oldSignal?.aborted,true);
  assert.equal(await second,true);
  assert.equal(replacementSignal?.aborted,false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(controller.getSnapshot().value,"ready");
  controller.stop();
});

test("a failed attempt can retry successfully without replacing the workspace controller",async()=>{
  const c=createPersonalInitializationController();c.start();
  assert.equal(await c.run("session",async()=>{throw Error("seed denied");}),false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.getSnapshot().value,"failed");
  assert.match(c.getSnapshot().context.error,/seed denied/);
  assert.equal(await c.run("session",async()=>true),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.getSnapshot().value,"ready");
  c.stop();c.start();
  assert.equal(c.getSnapshot().value,"idle");
  c.stop();
});

test("cancel and Strict Mode stop cannot publish a stale readiness or error",async()=>{
  const c=createPersonalInitializationController();c.start();
  const first=c.run("a",async ({signal})=>new Promise<boolean>(resolve=>signal.addEventListener("abort",()=>resolve(true),{once:true})));
  c.cancel();assert.equal(await first,false);
  assert.equal(c.getSnapshot().value,"idle");
  const second=c.run("b",async ({signal})=>new Promise<boolean>(resolve=>signal.addEventListener("abort",()=>resolve(true),{once:true})));
  c.stop();assert.equal(await second,false);
  c.start();assert.equal(c.getSnapshot().value,"idle");c.stop();
});

test("access gates accept only the current personal-initialization revision",()=>{
  const c=createMaestroAccessController();c.start();
  c.send({type:"SESSION_OBSERVED",restored:true,sessionKey:"s"});
  c.send({type:"AUTH_STATUS_OBSERVED",sessionKey:"s",state:"success",status:200,at:1});
  c.send({type:"POLICY_STATUS_OBSERVED",sessionKey:"s",attemptId:2,stage:"ready"});
  assert.equal(selectMaestroCapabilities(c.getSnapshot()).canUsePersonalStore,true);
  c.send({type:"POLICY_STATUS_OBSERVED",sessionKey:"s",attemptId:1,stage:"failed",error:"obsolete abort"});
  assert.equal(selectMaestroCapabilities(c.getSnapshot()).canUsePersonalStore,true);
  c.send({type:"POLICY_STATUS_OBSERVED",sessionKey:"s",attemptId:3,stage:"seeding"});
  assert.equal(selectMaestroCapabilities(c.getSnapshot()).canUsePersonalStore,false);
  c.send({type:"POLICY_STATUS_OBSERVED",sessionKey:"s",attemptId:2,stage:"ready"});
  assert.equal(selectMaestroCapabilities(c.getSnapshot()).canUsePersonalStore,false);
  c.send({type:"POLICY_STATUS_OBSERVED",sessionKey:"s",attemptId:3,stage:"ready"});
  assert.equal(selectMaestroCapabilities(c.getSnapshot()).canUsePersonalStore,true);
  c.stop();
});
