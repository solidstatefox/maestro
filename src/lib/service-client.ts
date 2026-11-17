"use client";
/** OpenAPI identity = registered service (or its server URL) + operationId.
 * The host resolves servers/paths/method from its allowlisted OAS registry;
 * browser owns input, policy, and transformation logic. */
import {readIteraComputeKey} from "@/lib/iteracompute-credential";
import {validateOpenAiChatPayload} from "@/lib/openai-chat-completions";
export async function callOpenApiService<T>(service:string,operationId:string,parameters:Record<string,string>={},signal?:AbortSignal):Promise<T>{
  const response=await fetch("/proxy/api/service",{
    method:"POST",cache:"no-store",credentials:"same-origin",signal,
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({service,operationId,parameters}),
  });
  if(!response.ok)throw new Error(`OpenAPI ${service}/${operationId}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
export async function callOpenAiChatCompletions(payload:Record<string,unknown>,signal?:AbortSignal):Promise<Response>{
  const invalid=validateOpenAiChatPayload(payload);if(invalid)throw new Error(invalid);
  const key=await readIteraComputeKey();
  if(!key)throw new Error("Configure an IteraCompute API key in Sheet → Maestro controls.");
  const body=JSON.stringify({service:"iteracompute",operationId:"createChatCompletion",payload});
  if(body.length>600_000)throw new Error("Chat request exceeds size limit.");
  return fetch("/proxy/api/service",{
    method:"POST",cache:"no-store",credentials:"same-origin",
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180_000)]):AbortSignal.timeout(180_000),
    headers:{"Content-Type":"application/json","x-maestro-iteracompute-key":key},body,
  });
}
