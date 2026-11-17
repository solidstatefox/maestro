"use client";
import { MAX_ROOT_URI_CHARS } from "@/lib/root-uri-policy";
/** Browsers provide clipboard text, not the timestamp of an external copy.
 * Only Maestro-observed copy/write events can satisfy a strict 10s freshness test. */
const MAX_AGE_MS=10_000;
let observedAt=0;
let observedText="";
export function noteMaestroClipboardCopy(text:string){
  // Do not truncate: that would silently turn a valid URL into a different URI.
  if (text.length > MAX_ROOT_URI_CHARS) { observedAt = 0; observedText = ""; return; }
  observedAt=Date.now();observedText=text;
}
export function listenForMaestroCopies():()=>void {
  const onCopy=(event:ClipboardEvent)=>{
    const text=event.clipboardData?.getData("text/plain") || window.getSelection()?.toString() || "";
    if(text)noteMaestroClipboardCopy(text);
  };
  document.addEventListener("copy",onCopy);
  return()=>document.removeEventListener("copy",onCopy);
}
export async function readRecentlyCopiedText():Promise<string|null>{
  if(!observedAt || Date.now()-observedAt>MAX_AGE_MS || !navigator.clipboard?.readText)return null;
  try{
    const text=await navigator.clipboard.readText();
    if(Date.now()-observedAt>MAX_AGE_MS || !text || text.length > MAX_ROOT_URI_CHARS || text!==observedText)return null;
    return text;
  }catch{return null;}
}
