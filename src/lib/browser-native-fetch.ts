/** Browser-only Turbopack alias for digest-fetch's Node fallback. */
export default function nativeFetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response>{
  return globalThis.fetch(input,init);
}
