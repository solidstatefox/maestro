import { digestEndpoint } from "./digest-session-record";
export function personalReadEndpoint(session:{graphStore:string}):string { return session.graphStore; }
export function personalWriteEndpoint(session:{graphStore:string;authType?:string}):string {
  if(session.authType!=="sparql-auth")throw new Error("Only restored SPARQL Digest sessions are supported.");
  return digestEndpoint(session);
}
export function personalAuthenticatedEndpoint(session:{graphStore:string;authType?:string}):string {return personalWriteEndpoint(session);}
