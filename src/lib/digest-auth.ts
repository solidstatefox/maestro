/** Server-only adapter to the installed digest-fetch 3.1.1 library.
 * The browser reserves nc; the library computes the Authorization value. */
import { DigestClient } from "digest-fetch";
import { DIGEST_SESSION_HEADER, DIGEST_SESSION_SCHEME, digestEndpoint, parseDigestSession, parseDigestIdentity, type DigestSessionIdentity, type DigestSessionRecord } from "./digest-session-record";

type PrecomputedClient = {
  hasAuth: boolean;
  parseAuth(challenge:string):void;
  digest: {scheme:string;algorithm:string;realm:string;qop:string;nonce:string;cnonce:string;opaque:string|null;nc:string};
  addAuth(url:string, options:{method:string;headers:Record<string,string>}):{headers:Record<string,string>};
};
function decodeDigestCarrier(request:Request):unknown {
  const encoded=request.headers.get(DIGEST_SESSION_HEADER);
  if(!encoded?.startsWith(DIGEST_SESSION_SCHEME) || encoded.length>24000)return null;
  try{return JSON.parse(decodeURIComponent(encoded.slice(DIGEST_SESSION_SCHEME.length)));}catch{return null;}
}
export function initialDigestIdentity(request:Request):DigestSessionIdentity|null {
  return parseDigestIdentity(decodeDigestCarrier(request));
}
/** Initial 401: devfans parses the challenge and prepares the first nonce count.
 * The resulting record must not be persisted until the authorized SELECT succeeds. */
export function initialDigestRecord(identity:DigestSessionIdentity, challenge:string|null):DigestSessionRecord|null {
  if(!challenge || !/^Digest\s/i.test(challenge))return null;
  const algorithm=DigestClient.parse(challenge,"algorithm");
  if(algorithm && algorithm.toUpperCase()!=="MD5")return null;
  const client=new DigestClient(identity.username,identity.ha1,{algorithm:"MD5",precomputedHash:true} as never) as unknown as PrecomputedClient;
  client.parseAuth(challenge);
  if(!client.hasAuth || client.digest.scheme.toLowerCase()!=="digest")return null;
  return parseDigestSession({...identity,...client.digest,nc:Number(client.digest.nc)});
}
export function staleDigestRecord(request:Request,endpoint:string,challenge:string|null):DigestSessionRecord|null {
  const previous=parseDigestSession(decodeDigestCarrier(request));
  if(!previous || digestEndpoint(previous)!==endpoint || !challenge || DigestClient.parse(challenge,"stale")?.toLowerCase()!=="true")return null;
  const next=initialDigestRecord(previous,challenge);
  return next && next.nonce!==previous.nonce ? next : null;
}
export function restoredDigestRecord(request:Request):DigestSessionRecord|null {return parseDigestSession(decodeDigestCarrier(request));}
export function restoredDigestAuthorization(request:Request, endpoint:string):string|null {
  const record=restoredDigestRecord(request);
  return record ? digestRecordAuthorization(record,endpoint) : null;
}
export function digestRecordAuthorization(record:DigestSessionRecord, endpoint:string):string|null {
  if(record.nc<1 || digestEndpoint(record)!==endpoint)return null;
  // v3.1.1's actual constructor uses precomputedHash (not the README's
  // precomputeHash). Its addAuth pads nc as a string, so supply hexadecimal.
  const client=new DigestClient(record.username,record.ha1,{algorithm:"MD5",precomputedHash:true} as never) as unknown as PrecomputedClient;
  client.hasAuth=true;
  client.digest={scheme:"Digest",algorithm:"MD5",realm:"SPARQL",qop:"auth",nonce:record.nonce,
    cnonce:record.cnonce,opaque:record.opaque,nc:record.nc.toString(16).padStart(8,"0")};
  return client.addAuth(endpoint,{method:"POST",headers:{}}).headers.Authorization??null;
}
