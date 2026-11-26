
import { attributedSparqlFetch } from "@/lib/sparql-request-attribution";
import { DIGEST_SESSION_DB, DIGEST_SESSION_STORE, DIGEST_SESSION_KEY, DIGEST_SESSION_HEADER, DIGEST_SESSION_SCHEME, parseDigestIdentity, parseDigestSession, digestEndpoint, type DigestSessionRecord } from "./digest-session-record";
import type { PersonalAuthSession } from "./personal-auth";
import type { PersonalRows } from "./client-personal-sparql";
import type { BootstrapBinding, BootstrapButton } from "./client-auth-bootstrap";

import type { PersonalGraphServer } from "./client-personal-graph-servers";
export type SessionKind = {id:string;pattern:string};
export type SessionSnapshot = {
  bindings:BootstrapBinding[]; kinds:SessionKind[]; servers:PersonalGraphServer[];
  buttons?:BootstrapButton[]; completedAt:number; seedRevision:string;
};
type SavedSession = DigestSessionRecord & {generation?:string;
  snapshot?:SessionSnapshot; httpOutcome?:{status:number;at:number}};
const generationOf=(record:SavedSession)=>record.generation??record.cnonce;
let active: {record:DigestSessionRecord; generation:string; session:PersonalAuthSession; abort:AbortController} | null = null;
const SESSION_CHANNEL = "maestro-user-session-changed";
let channel:BroadcastChannel|null=null;
export function subscribeDigestSessionChanges(listener:(kind:"changed"|"snapshot")=>void):()=>void {
  if(typeof BroadcastChannel === "undefined")return ()=>{};
  channel??=new BroadcastChannel(SESSION_CHANNEL);
  const current=channel;
  const onMessage=(event:MessageEvent)=>{if(event.data==="changed" || event.data==="snapshot")listener(event.data);};
  current.addEventListener("message",onMessage);
  return ()=>{current.removeEventListener("message",onMessage);current.close();if(channel===current)channel=null;};
}
function notifySessionChanged(kind:"changed"|"snapshot"="changed"):void { channel?.postMessage(kind); }
export async function withSessionInitializationLock<T>(signal:AbortSignal,task:()=>Promise<T>):Promise<T>{
  if(typeof navigator==="undefined" || !navigator.locks){
    if(!await readRecord().catch(()=>null))return task();
    throw new Error("Personal sessions require browser Web Locks.");
  }
  return await navigator.locks.request(`${SESSION_CHANNEL}:initialization`,{mode:"exclusive",signal},async()=>{signal.throwIfAborted();return task();});
}
/** Browser persistence is best-effort: Safari may still evict origin data. */
export function requestDigestPersistence():void {
  try{if(typeof navigator!=="undefined" && navigator.storage?.persist)
    void navigator.storage.persist().catch(()=>false);}catch{}
}
export async function withDigestSessionLock<T>(signal:AbortSignal|undefined,task:()=>Promise<T>):Promise<T>{
  if(typeof navigator==="undefined" || !navigator.locks) return Promise.reject(new Error("Personal sessions require browser Web Locks."));
  return await navigator.locks.request(SESSION_CHANNEL,{mode:"exclusive",...(signal?{signal}:{})},()=>{
    signal?.throwIfAborted();return task();
  });
}
function sameIdentity(a:DigestSessionRecord,b:DigestSessionRecord):boolean {
  return a.ha1===b.ha1 && a.username===b.username && a.graphStore===b.graphStore && a.graphPrefix===b.graphPrefix;
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable.")); return; }
    const req = indexedDB.open(DIGEST_SESSION_DB,1);
    let done=false;
    const timer=setTimeout(()=>{done=true;reject(new Error("IndexedDB unavailable."));},1500);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DIGEST_SESSION_STORE)) req.result.createObjectStore(DIGEST_SESSION_STORE);};
    req.onsuccess=()=>{clearTimeout(timer);if(done)req.result.close();else{done=true;resolve(req.result);}};
    req.onerror=req.onblocked=()=>{clearTimeout(timer);if(!done){done=true;reject(new Error("IndexedDB unavailable."));}};
  });
}
async function readRecord(): Promise<SavedSession|null> {
  const db=await openDb();
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction(DIGEST_SESSION_STORE,"readonly");
    const req=tx.objectStore(DIGEST_SESSION_STORE).get(DIGEST_SESSION_KEY);
    tx.oncomplete=()=>{const parsed=parseDigestSession(req.result);resolve(parsed?{...req.result,...parsed}:null);};
    tx.onabort=tx.onerror=()=>reject(new Error("Session read failed."));
  });}finally{db.close();}
}
/** URL load and Connect share this lookup. Missing, malformed or inaccessible records are anonymous. */
export async function restoreDigestSession(signal:AbortSignal):Promise<PersonalAuthSession|null> {
  try {
    const record=await readRecord();
    if(signal.aborted || !record)return null;
    if(active && sameIdentity(record,active.record) && generationOf(record)===active.generation)return active.session;
    const session:PersonalAuthSession={authType:"sparql-auth",graphStore:record.graphStore,graphPrefix:record.graphPrefix,
      username:record.username,userName:record.username,rememberMe:true};
    active?.abort.abort();
    active={record,generation:generationOf(record),session,abort:new AbortController()};
    return session;
  }catch{return null;}
}
/** Connect only. Never replace an existing valid record or reset its nonce count. */
export async function ensureDigestSession(input:{username:string;graphStore:string;graphPrefix:string;password:string},signal:AbortSignal,onHttpStatus:((status:number)=>void)|undefined, seedQuery:string,onChallengeSent?:()=>void):Promise<PersonalRows|undefined>{
  return withDigestSessionLock(signal,async()=>{
  signal.throwIfAborted();
  const existing=await readRecord();
  signal.throwIfAborted();
  if(existing)return;
  if(typeof location==="undefined" || (location.protocol!=="https:" && !["localhost","127.0.0.1","[::1]"].includes(location.hostname)))
    throw new Error("Personal Digest sessions require a secure Maestro origin.");
  const {DigestClient}=await import("digest-fetch");
  const username=input.username.trim();
  const client=new DigestClient(username,input.password,{algorithm:"MD5"} as never);
  const ha1=client.computeHash(username,"SPARQL",input.password);
  const identity=parseDigestIdentity({username,graphStore:input.graphStore.trim(),graphPrefix:input.graphPrefix.trim(),ha1});
  if(!identity || !input.password)throw new Error("Enter a valid personal graph endpoint, prefix, username and password.");
  signal.throwIfAborted();
  const challenge=await attributedSparqlFetch("/proxy/api/sparql",{method:"POST",cache:"no-store",redirect:"error",
    signal:AbortSignal.any([signal,AbortSignal.timeout(35_000)]),headers:{"x-maestro-debug-source":"urn:maestro:component:DigestConnect:Challenge","x-maestro-debug-component":"DigestConnect:Challenge","Content-Type":"application/json",
      [DIGEST_SESSION_HEADER]:DIGEST_SESSION_SCHEME+encodeURIComponent(JSON.stringify(identity))},
    body:JSON.stringify({operation:"auth-probe",query:seedQuery})});
  signal.throwIfAborted();
  if(challenge.status!==401){onHttpStatus?.(challenge.status);throw new Error(`Could not obtain the personal SPARQL Digest challenge (HTTP ${challenge.status}). Check that the graph server and authentication endpoint are available.`);}
  const metadata=await challenge.json().catch(()=>null);
  const record=parseDigestSession({...metadata,...identity});
  if(!record || record.nc<1){onHttpStatus?.(401);throw new Error("The personal graph server did not return a supported SPARQL Digest challenge (HTTP 401).");}
  signal.throwIfAborted();
  const endpoint=digestEndpoint(record);
  const addr=`${record.graphPrefix.replace(/\/+$/, "")}/query@${endpoint}`;
  const pending=attributedSparqlFetch("/proxy/api/sparql",{method:"POST",cache:"no-store",redirect:"error",
    signal:AbortSignal.any([signal,AbortSignal.timeout(60_000)]),headers:{"x-maestro-debug-source":"urn:maestro:component:DigestConnect:SeedDigests","x-maestro-debug-component":"DigestConnect:SeedDigests","Content-Type":"application/json",
      [DIGEST_SESSION_HEADER]:DIGEST_SESSION_SCHEME+encodeURIComponent(JSON.stringify(record))},
    body:JSON.stringify({addr,personalRead:true,query:seedQuery})});
  // Only now has the challenge response been sent to the proxy.
  onChallengeSent?.();
  const response=await pending;
  signal.throwIfAborted();
  onHttpStatus?.(response.status);
  if(!response.ok)throw new Error(response.status===401 || response.status===403
    ? `Personal SPARQL authentication was rejected (HTTP ${response.status}). Check your credentials and access permissions.`
    : `Personal SPARQL connection failed (HTTP ${response.status}). Check graph server availability and try again.`);
  const parsed=await response.json() as {results?:{bindings?:PersonalRows};incomplete?:boolean};
  if(parsed.incomplete || !Array.isArray(parsed.results?.bindings))throw new Error("Authentication seed digest query returned invalid SPARQL Results JSON.");
  const bindings=parsed.results.bindings;
  signal.throwIfAborted();
  let savedIdentity=false;
  const db=await openDb();
  try{await new Promise<void>((resolve,reject)=>{
    signal.throwIfAborted();
    const tx=db.transaction(DIGEST_SESSION_STORE,"readwrite");
    const store=tx.objectStore(DIGEST_SESSION_STORE);
    const req=store.get(DIGEST_SESSION_KEY);
    const abort=()=>{try{tx.abort();}catch{}};
    signal.addEventListener("abort",abort,{once:true});
    req.onsuccess=()=>{if(signal.aborted){abort();return;}if(!parseDigestSession(req.result)){store.put({...(refreshedDigestRecord(record,response)??record),generation:record.cnonce,httpOutcome:{status:response.status,at:Date.now()}},DIGEST_SESSION_KEY);savedIdentity=true;}};
    tx.oncomplete=()=>{signal.removeEventListener("abort",abort);resolve();};
    tx.onabort=tx.onerror=()=>{signal.removeEventListener("abort",abort);reject(new Error("Could not save personal user session."));};
  });}finally{db.close();}
  if(savedIdentity)notifySessionChanged();
  return savedIdentity?bindings:undefined;
  });
}
export function restoredDigestSession():PersonalAuthSession|null{return active?.session??null;}
export function disconnectDigestSession():void{active?.abort.abort();active=null; if(typeof window!=="undefined")window.dispatchEvent(new Event("maestro:personal-session-cleared"));}
export function digestSessionSignal(session:PersonalAuthSession,signal?:AbortSignal|null):AbortSignal {
  if(!active || active.session!==session)throw new Error("No restored personal user session.");
  return signal?AbortSignal.any([signal,active.abort.signal]):active.abort.signal;
}
/** One readwrite transaction reserves a unique count across tabs, before network dispatch. */
export async function reserveDigestRequest(session:PersonalAuthSession):Promise<DigestSessionRecord>{
  const current=active;
  if(!current || current.session!==session)throw new Error("No restored personal user session.");
  const db=await openDb();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(DIGEST_SESSION_STORE,"readwrite");
    const store=tx.objectStore(DIGEST_SESSION_STORE);
    const req=store.get(DIGEST_SESSION_KEY);
    let reserved:DigestSessionRecord|null=null;
    req.onsuccess=()=>{
      const record=parseDigestSession(req.result);
      if(active!==current || !record || !sameIdentity(record,current.record) || generationOf(req.result)!==current.generation){tx.abort();return;}
      if(record.nc>=0xfffffffe){tx.abort();return;}
      reserved={...record,nc:record.nc+1};
      store.put({...req.result,...reserved,generation:current.generation},DIGEST_SESSION_KEY);
    };
    tx.oncomplete=()=>{if(reserved && active===current)resolve(reserved);else reject(new Error("Personal user session changed."));};
    tx.onabort=tx.onerror=()=>reject(new Error("Cannot reserve the saved Digest nonce count."));
  });}finally{db.close();}
}

/** Metadata from one successful stale-nonce retry, while the same Web Lock is held. */
export function refreshedDigestRecord(previous:DigestSessionRecord,response:Response):DigestSessionRecord|null {
  const header=response.headers.get("x-maestro-digest-refresh");
  if(!response.ok || !header)return null;
  try {
    const metadata=JSON.parse(decodeURIComponent(header));
    const next=parseDigestSession({...previous,...metadata,username:previous.username,graphStore:previous.graphStore,graphPrefix:previous.graphPrefix,ha1:previous.ha1});
    return next && next.nc===1 && next.nonce!==previous.nonce ? next : null;
  }catch{return null;}
}
export async function commitRefreshedDigest(session:PersonalAuthSession,previous:DigestSessionRecord,response:Response):Promise<void>{
  const next=refreshedDigestRecord(previous,response);
  if(!next)return;
  const current=active;
  if(!current || current.session!==session)throw new Error("Personal user session changed.");
  const db=await openDb();
  try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(DIGEST_SESSION_STORE,"readwrite"),store=tx.objectStore(DIGEST_SESSION_STORE);
    const req=store.get(DIGEST_SESSION_KEY);
    req.onsuccess=()=>{
      const saved=parseDigestSession(req.result);
      if(active!==current || !saved || !sameIdentity(saved,previous) || generationOf(req.result)!==current.generation || saved.nonce!==previous.nonce || saved.cnonce!==previous.cnonce || saved.nc!==previous.nc){tx.abort();return;}
      store.put({...req.result,...next,generation:current.generation},DIGEST_SESSION_KEY);
    };
    tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error("Personal Digest nonce changed."));
  });}finally{db.close();}
}
export async function forgetDigestSession():Promise<void>{
  disconnectDigestSession();
  await withDigestSessionLock(undefined,async()=>{
  const db=await openDb();
  try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(DIGEST_SESSION_STORE,"readwrite");
    tx.objectStore(DIGEST_SESSION_STORE).delete(DIGEST_SESSION_KEY);
    tx.oncomplete=()=>resolve();
    tx.onabort=tx.onerror=()=>reject(new Error("Could not forget personal user session."));
  });}finally{db.close();}
  notifySessionChanged();
  });
}

/** Read the current generation's serializable data, not the Digest carrier. */
export async function readSessionHydration(session:PersonalAuthSession):Promise<Pick<SavedSession,"snapshot"|"httpOutcome">>{
  const current=active;
  const record=await readRecord();
  if(!current || current!==active || current.session!==session || !record || !sameIdentity(record,current.record) || generationOf(record)!==current.generation)
    throw new Error("Personal user session changed.");
  const snapshot=record.snapshot;
  if(snapshot!==undefined && (!snapshot || !Number.isFinite(snapshot.completedAt) ||
      !Array.isArray(snapshot.bindings) || !snapshot.bindings.some(row=>row?.section?.value==="probe") ||
      !Array.isArray(snapshot.kinds) || !snapshot.kinds.length || !snapshot.kinds.every(row=>typeof row?.id==="string" && typeof row?.pattern==="string") ||
      !Array.isArray(snapshot.servers) || !snapshot.servers.every(row=>typeof row?.uri==="string" && typeof row?.url==="string" && typeof row?.label==="string" && typeof row?.description==="string" && typeof row?.isPersonal==="boolean") ||
      (snapshot.buttons!==undefined && (!Array.isArray(snapshot.buttons) || !snapshot.buttons.every(row=>[row?.uri,row?.action,row?.icon,row?.tooltip,row?.url].every(value=>typeof value==="string"))))))
    return {httpOutcome:record.httpOutcome};
  return {snapshot,httpOutcome:record.httpOutcome};
}
async function changeSavedSession(session:PersonalAuthSession,change:(record:SavedSession)=>SavedSession,signal?:AbortSignal):Promise<void>{
  const current=active;
  if(!current || current.session!==session)throw new Error("Personal user session changed.");
  signal?.throwIfAborted();
  const db=await openDb();
  try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(DIGEST_SESSION_STORE,"readwrite"),store=tx.objectStore(DIGEST_SESSION_STORE);
    const req=store.get(DIGEST_SESSION_KEY);
    const abort=()=>{try{tx.abort();}catch{}};
    signal?.addEventListener("abort",abort,{once:true});
    req.onsuccess=()=>{
      const saved=parseDigestSession(req.result);
      if(signal?.aborted || active!==current || !saved || !sameIdentity(saved,current.record) || generationOf(req.result)!==current.generation){abort();return;}
      try{store.put(change({...req.result,...saved,generation:current.generation}),DIGEST_SESSION_KEY);}catch{abort();}
    };
    tx.oncomplete=()=>{signal?.removeEventListener("abort",abort);resolve();};
    tx.onabort=tx.onerror=()=>{signal?.removeEventListener("abort",abort);reject(new Error("Could not persist personal user session."));};
  });}finally{db.close();}
}
export async function commitSessionSnapshot(session:PersonalAuthSession,snapshot:SessionSnapshot,signal:AbortSignal):Promise<void>{
  await changeSavedSession(session,record=>({...record,snapshot}),signal);
  notifySessionChanged("snapshot");
}
/** Explicit successful mutations merge only the affected projection. */
export async function updateSessionSnapshot(session:PersonalAuthSession,change:Partial<Pick<SessionSnapshot,"buttons"|"servers"|"bindings">>|((snapshot:SessionSnapshot)=>Partial<Pick<SessionSnapshot,"buttons"|"servers"|"bindings">>)):Promise<void>{
  await changeSavedSession(session,record=>{
    if(!record.snapshot)throw new Error("Personal session is not initialized.");
    return {...record,snapshot:{...record.snapshot,...(typeof change==="function"?change(record.snapshot):change)}};
  });
  notifySessionChanged("snapshot");
}
export async function rememberDigestHttpOutcome(session:PersonalAuthSession,status:number,at:number):Promise<void>{
  await changeSavedSession(session,record=>record.httpOutcome && record.httpOutcome.at>at ? record : {...record,httpOutcome:{status,at}});
}
