"use client";
/** Login belongs to the browser. The CORS bridge forwards HTTP, never
 * authenticates a Maestro session or parses an RDF/WebID profile. */
import type { PersonalAuthSession } from "@/lib/personal-auth";
import { forwardHttp } from "@/lib/client-http-forward";

export async function testPersonalGraph(session: PersonalAuthSession, signal?: AbortSignal): Promise<{
  ok: boolean; connected: boolean; status?: number; readEndpoint?: string; writeEndpoint?: string; error?: string;
}> {
  let read: URL;
  try {
    read = new URL(session.graphStore);
    if(!["http:","https:"].includes(read.protocol))throw Error("Unsupported URL protocol.");
  } catch { return {ok:false,connected:false,error:"A valid HTTP(S) Graph Store URL is required."}; }
  read.pathname=read.pathname.replace(/\/sparql-auth\/?$/i,"/sparql");
  const write=new URL(read.toString());
  if(session.authType==="sparql-auth")write.pathname=write.pathname.replace(/\/sparql\/?$/i,"/sparql-auth");
  // The login credential remains browser owned.  Read connectivity is tested
  // against the authenticated graph server through the existing /sparql route.
  // A transient cookie is necessary because that unmodified route expects the
  // same session format as the pre-migration build.
  const {setMaestroSessionCookie}=await import("@/lib/personal-auth");
  const previous=document.cookie.match(/(?:^|;\s*)maestro_session=([^;]+)/)?.[1];
  try {
    setMaestroSessionCookie(session);
    // First login has no endpoint registry yet. Its UPDATE transport does not
    // require endpoint discovery; register the personal endpoint before the
    // read-only SELECT probe (the graph server enforces write ACLs).
    const base=`${session.graphPrefix.replace(/\/+$/,"")}/query`;
    const registry=`${base}/graph`;
    const ep=`gttp://ggg.maestro.ecosys/ids/dataservers/endpoints#personal-sparql`;
    const valid=(value:string)=>value.length<4096&&!/[\s<>"{}|^`\\]/.test(value);
    if(!valid(base)||!valid(read.toString()))throw new Error("Invalid personal graph or endpoint URI.");
    const registration=`INSERT DATA { GRAPH <${registry}> { <${ep}> a <https://schema.org/EntryPoint> ; <http://www.w3.org/2000/01/rdf-schema#label> "Personal SPARQL" ; <https://schema.org/url> <${read.toString()}> . } }`;
    const registerResponse=await fetch("/proxy/api/sparql",{method:"POST",credentials:"same-origin",cache:"no-store",signal,
      headers:{"Content-Type":"application/json"},body:JSON.stringify({update:registration})});
    if(!registerResponse.ok)throw new Error(`Personal graph registry write failed (HTTP ${registerResponse.status}): ${(await registerResponse.text()).slice(0,350)}`);
    const response=await fetch("/proxy/api/sparql",{method:"POST",credentials:"same-origin",cache:"no-store",signal,
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({addr:`${session.graphPrefix.replace(/\/+$/,"")}/query@${read.toString()}`,query:"SELECT ?s WHERE { ?s ?p ?o } LIMIT 1"})});
    const body=await response.text();
    if(!response.ok)return {ok:false,connected:false,status:response.status,
      error:`Graph server read failed (HTTP ${response.status}): ${body.slice(0,350)}`};
    return {ok:true,connected:true,status:200,readEndpoint:read.toString(),writeEndpoint:write.toString()};
  } catch(error) {
    return {ok:false,connected:false,error:`Could not reach graph server: ${error instanceof Error?error.message:String(error)}`};
  } finally {
    document.cookie=previous?`maestro_session=${previous}; path=/; SameSite=Lax`:
      "maestro_session=; path=/; max-age=0; SameSite=Lax";
  }
}

export async function fetchWebIdProfile(profileUrl:string,signal?:AbortSignal): Promise<{avatarUrl?:string;displayName?:string}> {
  let parsed:URL;
  try{parsed=new URL(profileUrl);if(!["http:","https:"].includes(parsed.protocol))throw Error("Unsupported URL protocol.");}
  catch{throw new Error("A valid WebID or OpenID URL is required.");}
  parsed.hash="";
  const response=await forwardHttp({url:parsed.toString(),method:"GET",headers:{Accept:"text/turtle, application/ld+json, application/json, application/rdf+xml, text/plain"}},signal);
  if(!response.ok)throw new Error(`Could not retrieve profile (HTTP ${response.status}).`);
  const mime=response.headers.get("content-type")??"",body=await response.text();
  let avatarUrl:string|undefined,displayName:string|undefined;
  if(mime.includes("json")||body.trim().startsWith("{")){
    try{
      const json=JSON.parse(body) as Record<string,unknown>;
      avatarUrl=[json.picture,json.avatar,json.avatar_url,json.image].find((v):v is string=>typeof v==="string");
      displayName=[json.name,json.preferred_username,json.nickname,json.given_name].find((v):v is string=>typeof v==="string");
    }catch{/* JSON parse failure is nonfatal. */}
  }
  if(!avatarUrl){
    const found=body.match(/(?:foaf:img|foaf:depiction|vcard:hasPhoto|schema:image|<http:\/\/xmlns\.com\/foaf\/0\.1\/img>|<http:\/\/xmlns\.com\/foaf\/0\.1\/depiction>|<http:\/\/www\.w3\.org\/2006\/vcard\/ns#hasPhoto>|<https:\/\/schema\.org\/image>)\s+<([^>]+)>/i);
    avatarUrl=found?.[1];
  }
  if(!displayName){
    const found=body.match(/(?:foaf:name|rdfs:label|vcard:fn|schema:name|<http:\/\/xmlns\.com\/foaf\/0\.1\/name>|<http:\/\/www\.w3\.org\/2000\/01\/rdf-schema#label>)\s+"([^"]+)"/i);
    displayName=found?.[1];
  }
  if(avatarUrl)try{avatarUrl=new URL(avatarUrl,parsed).toString();}catch{avatarUrl=undefined;}
  return {avatarUrl,displayName};
}
