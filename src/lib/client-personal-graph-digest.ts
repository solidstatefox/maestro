"use client";
/** Graph list synchronization follows a successful authentication bootstrap.
 * A digest suppresses repeated list transfer, never asserts graph permissions. */
import { loadPersonalAuthSession, type PersonalAuthSession } from "@/lib/personal-auth";
import { personalRequestHeaders } from "@/lib/client-personal-request";

export const PERSONAL_GRAPH_LIST_CHANGED="maestro:personal-graph-list-changed";
const STORAGE_PREFIX="maestro-personal-graph-list-v1:";
type Snapshot={digest:string;graphs:string[]};
function key(session:PersonalAuthSession):string {
  return `${STORAGE_PREFIX}${encodeURIComponent([session.graphPrefix,session.graphStore,session.authType,session.userName??session.username??""].join("\u0000"))}`;
}
export function cachedPersonalGraphList(session:PersonalAuthSession):Snapshot|null {
  if(typeof window==="undefined")return null;
  try { const parsed=JSON.parse(localStorage.getItem(key(session))??"null") as Snapshot|null;
    return parsed && /^sha256:[a-f0-9]{64}$/.test(parsed.digest)&&Array.isArray(parsed.graphs)?parsed:null;
  } catch {return null;}
}
export async function syncPersonalGraphList(signal?:AbortSignal):Promise<Snapshot|null> {
  const session=await loadPersonalAuthSession();if(!session)return null;
  const before=cachedPersonalGraphList(session);
  const response=await fetch("/proxy/api/sparql",{method:"POST",cache:"no-store",signal,
    headers:{"Content-Type":"application/json",...personalRequestHeaders(session)},
    body:JSON.stringify({operation:"graph-list-digest",digest:before?.digest??""})});
  if(!response.ok)throw new Error(`Personal graph-list synchronization failed (HTTP ${response.status}).`);
  const result=await response.json() as {unchanged?:boolean;digest?:string;graphs?:string[]};
  if(signal?.aborted)return before;
  if(result.unchanged===true && result.digest===before?.digest)return before;
  if(!/^sha256:[a-f0-9]{64}$/.test(result.digest??"")||!Array.isArray(result.graphs)||
    !result.graphs.every(value=>typeof value==="string"))throw new Error("Invalid personal graph-list digest response.");
  const next={digest:result.digest!,graphs:result.graphs};
  localStorage.setItem(key(session),JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(PERSONAL_GRAPH_LIST_CHANGED,{detail:{digest:next.digest}}));
  return next;
}
