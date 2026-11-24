import { restoredDigestSession, disconnectDigestSession, forgetDigestSession } from "./client-digest-session";
/** Existing public user-session and graph namespace contracts. */
export type AuthType = "sparql-auth" | "sparql-oauth" | "sparql-webid";

export interface PersonalAuthSession {
  authType: AuthType;
  graphStore: string;
  graphPrefix: string;
  username?: string;
  userName?: string;
  password?: string;
  token?: string;
  oauthToken?: string;
  oauthProfileUrl?: string;
  webId?: string;
  webIdUri?: string;
  displayName?: string;
  avatarUrl?: string;
  rememberMe: boolean;
  authHeader?: string;
}

export { personalReadEndpoint, personalWriteEndpoint, personalAuthenticatedEndpoint } from "./personal-endpoints";

export interface PublicSessionPayload {
  graphStore: string;
  graphPrefix: string;
  authType: AuthType;
  authHeader?: string;
  userName?: string;
  userAvatar?: string;
}

/** Path appended to the user's graph prefix to form the Maestro graph (history, bookmarks, /graph files). */
export const MAESTRO_GRAPH_PATH = "/query";

/** e.g. http://host/DAV/home/acme -> http://host/DAV/home/acme/query */
export function graphForPrefix(prefix: string): string {
  return `${(prefix || "").trim().replace(/\/+$/, "")}${MAESTRO_GRAPH_PATH}`;
}


export const PERSONAL_SESSION_CHANGED = "maestro:personal-session-changed";
export function buildAuthHeader(..._args: unknown[]): string { return ""; }
export async function savePersonalAuthSession(..._args: unknown[]): Promise<void> {}
export async function loadPersonalAuthSession(): Promise<PersonalAuthSession | null> { return restoredDigestSession(); }
export async function loadPersonalAuthHint(): Promise<null> { return null; }
export async function clearPersonalAuthSession(): Promise<void> { await forgetDigestSession(); }
export function disconnectPersonalAuthSession(): void { disconnectDigestSession(); }
