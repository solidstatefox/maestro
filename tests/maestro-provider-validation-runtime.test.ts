import { test } from "node:test";
import assert from "node:assert/strict";
import { createMaestroProviderValidationController } from "../src/lib/app-lifecycle/provider-validation";
import { createMaestroKindDiscoveryController, selectKinds } from "../src/lib/app-lifecycle/kind-discovery";
import type { ProviderPageProgram } from "../src/lib/provider-page-program";
import { isVirtuosoAnytime, anytimeResponseHeaders } from "../src/lib/virtuoso-anytime";
const wait=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const program:ProviderPageProgram={data:{focus:[{iri:"urn:test:focus",label:"Test"}],triples:[]},message:"",description:"",radar:null};
const report={complete:true,conforms:true,message:"ok",violations:[],unsupportedConstraints:[]};
test("generic validation actor deduplicates semantic inputs and rejects superseded completions",async()=>{
 const controller=createMaestroProviderValidationController();controller.start();
 let prepare=0,loaded=0,validated=0,finish:((v:typeof report)=>void)|undefined,validationSignal:AbortSignal|undefined;
 const input={prepare:async()=>{prepare++;return program;},load:async()=>{loaded++;return [];},validate:async(_program:ProviderPageProgram,_policy:unknown,signal:AbortSignal)=>{validated++;validationSignal=signal;return new Promise<typeof report>(resolve=>finish=resolve);}};
 try{
 controller.validate("page1",input);await wait();await wait();assert.equal(controller.getSnapshot().value,"validating");
 controller.validate("page1",input);assert.equal(prepare,1);assert.equal(loaded,1);assert.equal(validated,1);
 controller.cancel();assert.equal(validationSignal?.aborted,true);finish?.(report);await wait();assert.equal(controller.getSnapshot().value,"cancelled");
 controller.validate("page2",{...input,validate:async()=>report});await wait();await wait();assert.equal(controller.getSnapshot().value,"ready");
 }finally{controller.stop();}
});
test("Properties Kinds can be partial while Roles fails, retry does not discard positive Properties evidence",async()=>{
 const properties=createMaestroKindDiscoveryController(),roles=createMaestroKindDiscoveryController();properties.start();roles.start();
 try{
 properties.execute("p",async()=>({kinds:["numeric"],incomplete:true}));roles.execute("r",async()=>{throw new Error("timeout");});await wait();
 assert.deepEqual(selectKinds(properties.getSnapshot(),"p").availability,["numeric"]);assert.equal(selectKinds(properties.getSnapshot(),"p").partial,true);assert.equal(selectKinds(roles.getSnapshot(),"r").error,"timeout");
 roles.execute("r2",async()=>({kinds:["text"],incomplete:false}));await wait();assert.equal(selectKinds(roles.getSnapshot(),"r2").ready,true);assert.deepEqual(selectKinds(properties.getSnapshot(),"p").availability,["numeric"]);
 }finally{properties.stop();roles.stop();}
});
test("Anytime metadata is distinct from a hard transport timeout",()=>{
 const partial=new Response('{}',{headers:{"X-SQL-State":"S1TAT"}});assert.equal(isVirtuosoAnytime(partial),true);assert.equal(anytimeResponseHeaders(partial,true)["X-Maestro-Incomplete"],"true");assert.equal(isVirtuosoAnytime(new Response('{}',{status:504})),false);assert.equal(isVirtuosoAnytime(new Response('{}',{status:206})),true);
});
