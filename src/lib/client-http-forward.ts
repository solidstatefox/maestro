"use client";
/** Browser request to a public linked-data URL.  This is NOT a server proxy.
 * Cross-origin sources must permit browser CORS, or be fetched by the graph server
 * using SPARQL LOAD into the user's own graph.  External registered OpenAPI
 * operations go through /proxy/api/service, not this function. */
export type ForwardRequest={url:string;method?:"GET"|"POST"|"PUT"|"PATCH"|"DELETE"|"HEAD";headers?:Record<string,string>;body?:string};
export async function forwardHttp(input:ForwardRequest,signal?:AbortSignal):Promise<Response>{
  const url=new URL(input.url);
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password)
    throw new Error("Invalid public Linked Data URL.");
  if((input.method??"GET")!=="GET"||input.body!==undefined)
    throw new Error("Unregistered HTTP operations must use the appropriate registered service or SPARQL route.");
  return fetch(url.href,{method:"GET",headers:input.headers,signal,redirect:"follow",cache:"no-store"});
}
