/** Only public, immutable, build-authored artifacts belong in this cache.
 * A cache hit is accepted only after SHA-256 verification against the current
 * same-origin build manifest. No credentials, policy decisions, RDF or
 * rendered user data are persisted here. */
const CACHE_NAME="maestro-verified-build-artifacts";
const MAX_ARTIFACT_BYTES=16*1024*1024;
const MAX_ENTRIES=4;
export async function sha256Hex(bytes:Uint8Array):Promise<string>{
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes).buffer))].map(value=>value.toString(16).padStart(2,"0")).join("");
}
export async function verifiedArtifactText(response:Response,digest:string):Promise<string>{
  if(!response.ok)throw new Error(`Build artifact returned HTTP ${response.status}.`);
  if(!/^[a-f0-9]{64}$/.test(digest))throw new Error("Invalid build artifact digest.");
  const declared=response.headers.get("content-length");
  if(declared&&Number(declared)>MAX_ARTIFACT_BYTES)throw new Error("Build artifact exceeds size limit.");
  // Bound actual bytes as well: Content-Length can be absent or compressed.
  const reader=response.body?.getReader();
  if(!reader)throw new Error("Build artifact has no body.");
  const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_ARTIFACT_BYTES){await reader.cancel();throw new Error("Build artifact exceeds size limit.");}chunks.push(part.value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  if(await sha256Hex(bytes)!==digest)throw new Error("Build artifact checksum mismatch.");
  return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
async function optionalCache<T>(task:Promise<T>,milliseconds:number):Promise<T|null>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([task.catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),milliseconds);})]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
}
export async function readVerifiedBuildArtifact(asset:string,digest:string):Promise<string>{
  if(!/^\/maestro-sef\/[a-z0-9._-]+\.json$/.test(asset)||!/^[a-f0-9]{64}$/.test(digest))throw new Error("Invalid build artifact manifest entry.");
  const signal=AbortSignal.timeout(15000);
  // A synthetic cache key is never fetched. The actual network URL comes
  // from the trusted same-origin build manifest, not the provider stylesheet.
  const key=new URL(`/maestro-sef/cache/${digest}`,location.origin).href;
  const store=typeof caches==="undefined"?null:await optionalCache(caches.open(CACHE_NAME),400);
  const cached=store?await optionalCache(store.match(key),400):null;
  if(cached){
    const checked=await optionalCache(verifiedArtifactText(cached,digest),1000);
    if(checked!==null)return checked;
    void store?.delete(key).catch(()=>false);
  }
  const response=await fetch(asset,{cache:"no-cache",credentials:"same-origin",signal});
  const text=await verifiedArtifactText(response,digest);
  if(store){
    // Awaiting optional disk storage must not delay the transformation.
    void (async()=>{
      await store.put(key,new Response(text,{headers:{"Content-Type":"application/json"}}));
      const keys=await store.keys();
      for(const request of keys.slice(0,Math.max(0,keys.length-MAX_ENTRIES)))await store.delete(request);
    })().catch(()=>{});
  }
  return text;
}
