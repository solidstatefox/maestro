"use client";
import { runActorQuery } from "./actor-query-authority";
import { assign, createActor, fromPromise, setup } from "xstate";
import type { BookmarkMetadata } from "../bookmark-metadata-update";
import { clientQueryFavorites } from "../client-query-favorites";
export const EDIT_BOOKMARK_REQUEST="maestro:edit-bookmark-metadata";
export const BOOKMARK_METADATA_UPDATED="maestro:bookmark-metadata-updated";
const blank=():BookmarkMetadata=>({title:"",description:"",tags:[],tagVocabulary:"skos"});
type Context={id:string;metadata:BookmarkMetadata;error:string};
type Event={type:"OPEN";id:string}|{type:"CHANGE";metadata:BookmarkMetadata}|{type:"SAVE"}|{type:"CLOSE"};
const initial=():Context=>({id:"",metadata:blank(),error:""});
const failure=(e:unknown)=>e instanceof Error?e.message:String(e);
async function request(body:object,signal:AbortSignal){
 const response=await clientQueryFavorites({method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal});
 const data=await response.json();if(!response.ok)throw new Error(data.error??`HTTP ${response.status}`);return data;
}
export const bookmarkMetadataMachine=setup({types:{context:{} as Context,events:{} as Event},actors:{
 read:fromPromise(async({input,signal}:{input:string;signal:AbortSignal}):Promise<BookmarkMetadata>=>{const data=await runActorQuery("bookmark-metadata",signal,owned=>request({action:"read",historyId:input},owned));if(!data.savedBookmark)throw new Error("Bookmark no longer exists.");return {title:data.title||input,description:data.description??"",tags:data.tags??[],tagVocabulary:data.tagVocabulary??"skos"};}),
 write:fromPromise(async({input,signal}:{input:Context;signal:AbortSignal})=>{const data=await runActorQuery("bookmark-metadata",signal,owned=>request({action:"updateMetadata",historyId:input.id,...input.metadata},owned));if(!data.updated||data.historyId!==input.id)throw new Error("Bookmark update was not confirmed.");}),
}}).createMachine({id:"bookmark-metadata",initial:"closed",context:initial,on:{CLOSE:{target:".closed",actions:assign(initial)}},states:{
 closed:{on:{OPEN:{target:"reading",actions:assign(({event})=>({...initial(),id:event.id}))}}},
 reading:{invoke:{src:"read",input:({context})=>context.id,onDone:{target:"editing",actions:assign(({event})=>({metadata:event.output,error:""}))},onError:{target:"readFailed",actions:assign(({event})=>({error:failure(event.error)}))}}},
 readFailed:{},
 editing:{on:{CHANGE:{actions:assign(({event})=>({metadata:event.metadata,error:""}))},SAVE:{target:"saving",guard:({context})=>Boolean(context.metadata.title.trim())}}},
 saving:{invoke:{src:"write",input:({context})=>context,onDone:{target:"updated"},onError:{target:"editing",actions:assign(({event})=>({error:failure(event.error)}))}}},
 updated:{},
}});
const fresh=()=>createActor(bookmarkMetadataMachine);
export function createBookmarkMetadataController(){
 let actor:ReturnType<typeof fresh>|null=null;let snapshot=fresh().getSnapshot();let subscription:{unsubscribe():void}|null=null;
 const listeners=new Set<()=>void>();const publish=()=>{for(const listener of listeners)listener();};
 return {start(){if(actor)return;actor=fresh();subscription=actor.subscribe(next=>{snapshot=next;publish();});actor.start();},stop(){subscription?.unsubscribe();subscription=null;actor?.stop();actor=null;snapshot=fresh().getSnapshot();publish();},send(event:Event){actor?.send(event);},getSnapshot:()=>snapshot,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}};
}
