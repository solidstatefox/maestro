import { observedUpstreamStatus } from "./proxy-transport-observation";
import type { PersonalAuthSession } from "@/lib/personal-auth";
/** Completed protected HTTP observations for existing XState consumers. */
export const PERSONAL_AUTH_OUTCOME = "maestro:personal-auth-http-outcome";
/** Only a FINAL upstream 401 raises this event. */
export const PERSONAL_AUTH_REJECTED = "maestro:personal-auth-final-401";

export type PersonalHttpState = "success" | "rejected" | "degraded";
export type PersonalHttpOutcome = {
  endpoint: string;
  principal: string;
  status: number | null;
  timestamp: number;
  state: PersonalHttpState;
  /** Preserved even after a later 401 or transport failure. */
  lastSuccessAt?: number;
};


export function classifyPersonalHttpState(status:number|null):PersonalHttpState {
  if(status!==null && status>=200 && status<300)return "success";
  if(status!==null && status>=400 && status<500)return "rejected";
  return "degraded";
}

const outcomes=new WeakMap<PersonalAuthSession,PersonalHttpOutcome>();
export function lastPersonalHttpOutcome(session:PersonalAuthSession):PersonalHttpOutcome|null {return outcomes.get(session)??null;}
function publish(session:PersonalAuthSession,status:number|null,timestamp=Date.now()):void{
  const state=classifyPersonalHttpState(status);
  outcomes.set(session,{endpoint:session.graphStore,principal:session.username??session.userName??"",status,timestamp,state});
  if(typeof window!=="undefined")window.dispatchEvent(new Event(PERSONAL_AUTH_OUTCOME));
}
export function hydratePersonalHttpOutcome(session:PersonalAuthSession,outcome:{status:number;at:number}):void{
  if((outcomes.get(session)?.timestamp??0)<=outcome.at)publish(session,outcome.status,outcome.at);
}
export function observePersonalAuthResponse(response:Response,session:PersonalAuthSession,_responseBody?:string):Response{const status=observedUpstreamStatus(response);if(status!==null)publish(session,status);return response;}

export async function markPersonalSuccessHint(_session:PersonalAuthSession):Promise<void>{}
export function clearPersonalSuccessHint():void{}
