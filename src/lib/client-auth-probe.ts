"use client";
/** Login belongs to the browser. The CORS bridge forwards HTTP, never
 * authenticates a Maestro session or parses an RDF/WebID profile. */
import { personalReadEndpoint, personalWriteEndpoint, type PersonalAuthSession } from "@/lib/personal-auth";
import { authBootstrapSelect, type BootstrapBinding } from "@/lib/client-auth-bootstrap";
import { personalRequestHeaders } from "@/lib/client-personal-request";
import { forwardHttp } from "@/lib/client-http-forward";

const LOGIN_PROBE_TIMEOUT_MS = 15_000;
// A fixed query only tests that the personal SPARQL endpoint responds; it must
// never enumerate the user's graphs or require the registry to be seeded first.

export async function testPersonalGraph(session: PersonalAuthSession, signal?: AbortSignal): Promise<{
  ok: boolean; connected: boolean; status?: number; readEndpoint?: string; writeEndpoint?: string; error?: string; bootstrap?: BootstrapBinding[];
}> {
  let read: URL, write: URL;
  try {
    read = new URL(personalWriteEndpoint(session));
    // Validate the selected authentication method's write URL, but do not make
    // a mutation during an otherwise read-only connection test.
    write = new URL(personalWriteEndpoint(session));
    if (!session.graphPrefix || !/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(session.graphPrefix)) {
      throw new Error("Enter a valid personal graph prefix URI.");
    }
  } catch (error) {
    return { ok: false, connected: false, error: `Invalid personal graph configuration: ${error instanceof Error ? error.message : String(error)}` };
  }

  // The same authenticated SPARQL SELECT is the connection test.
  // The proxy answers Virtuoso's HTTP Digest challenge on this request.
  const timeout = AbortSignal.timeout(LOGIN_PROBE_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    if (requestSignal.aborted) throw requestSignal.reason;
    const response = await fetch("/proxy/api/sparql", {
      method: "POST",
      cache: "no-store",
      signal: requestSignal,
      headers: { "Content-Type": "application/json", ...personalRequestHeaders(session) },
      body: JSON.stringify({
        personalRead: true,
        addr: `${session.graphPrefix.replace(/\/+$/, "")}/query@${read.toString()}`,
        query: authBootstrapSelect(session),
      }),
    });
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? "Authentication was rejected. Check the credentials and personal SPARQL endpoint."
        : `Personal SPARQL connection probe failed (HTTP ${response.status}).`;
      return { ok: false, connected: false, status: response.status, error: message };
    }
    // The authenticated personal SELECT route must return SPARQL Results JSON.
    // Check the protocol response rather than treating an HTML login form as OK.
    const payload: unknown = await response.json();
    const results = payload as { results?: { bindings?: BootstrapBinding[] } } | null;
    if (!results || !Array.isArray(results.results?.bindings)) {
      return { ok: false, connected: false, status: response.status,
        error: "Personal SPARQL endpoint returned an invalid SELECT result." };
    }
    return { ok: true, connected: true, status: response.status,
      readEndpoint: read.toString(), writeEndpoint: write.toString(), bootstrap:results.results!.bindings! };
  } catch (error) {
    const timedOut = timeout.aborted && !signal?.aborted;
    const cancelled = signal?.aborted;
    return { ok: false, connected: false, error: timedOut
      ? `Personal SPARQL connection probe timed out after ${LOGIN_PROBE_TIMEOUT_MS / 1000} seconds.`
      : cancelled ? "Personal SPARQL connection test was cancelled."
        : `Could not reach personal SPARQL endpoint: ${error instanceof Error ? error.message : String(error)}` };
  }

}

export async function fetchWebIdProfile(profileUrl:string,signal?:AbortSignal): Promise<{avatarUrl?:string;displayName?:string}> {
  let parsed:URL;
  try{parsed=new URL(profileUrl);if(!["http:","https:"].includes(parsed.protocol))throw Error("Unsupported URL protocol.");}
  catch(error){throw new Error(`A valid WebID or OpenID URL is required: ${error instanceof Error ? error.message : String(error)}`, {cause:error});}
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
