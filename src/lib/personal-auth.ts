import { browserLog } from "@/lib/maestro-client-logging";
/**
 * Personal Graph Server Authentication & Session Management.
 * Supports Virtuoso's sparql-auth, sparql-oauth, and sparql-webid protocols.
 * Encrypts sensitive credentials locally in browser storage.
 */

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

const STORAGE_KEY = "maestro_personal_auth_v1";
let cachedAuthRaw: string | null = null;
let cachedAuthSession: PersonalAuthSession | null = null;
// Disconnect pauses automatic local credential recovery only until reload or
// a new verified login. It never destroys the remembered encrypted record.
let disconnectedForThisPage = false;

const DEVICE_KEY_NAME = "maestro_device_salt";
export const AUTH_EXPECTED_KEY = "maestro_login_expected_v1";

/** Generate or retrieve a persistent client-side encryption key for local credential storage. */
async function getStorageCryptoKey(): Promise<CryptoKey> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("Web Crypto API is unavailable in this environment.");
  }
  let rawSalt = window.localStorage.getItem(DEVICE_KEY_NAME);
  if (!rawSalt) {
    const saltBytes = new Uint8Array(16);
    window.crypto.getRandomValues(saltBytes);
    rawSalt = Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(DEVICE_KEY_NAME, rawSalt);
  }
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(`maestro-sec-${rawSalt}`),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(rawSalt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt arbitrary string data with AES-GCM before saving to localStorage/sessionStorage. */
export async function encryptSecret(plainText: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle) throw new Error("Encrypted credential storage needs Web Crypto.");
  try {
    const key = await getStorageCryptoKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plainText);
    const cipherBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded,
    );
    const cipherBytes = new Uint8Array(cipherBuffer);
    const combined = new Uint8Array(iv.length + cipherBytes.length);
    combined.set(iv, 0);
    combined.set(cipherBytes, iv.length);
    return btoa(String.fromCharCode(...combined));
  } catch {
    throw new Error("Could not encrypt remembered credentials.");
  }
}

/** Decrypt AES-GCM ciphertext from storage. */
export async function decryptSecret(cipherBase64: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle)
    throw new Error("Web Crypto is required to decrypt remembered credentials.");
  try {
    const binary = atob(cipherBase64);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);
    const iv = combined.slice(0, 12);
    const cipherBytes = combined.slice(12);
    const key = await getStorageCryptoKey();
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipherBytes,
    );
    return new TextDecoder().decode(decryptedBuffer);
  } catch {
    throw new Error("Remembered credentials could not be decrypted.");
  }
}

/** Build the Authorization header value for a session or individual parameters. */
export function buildAuthHeader(
  sessionOrType: Partial<PersonalAuthSession> | AuthType,
  username?: string,
  password?: string,
  token?: string,
  _ignored?: string,
  webId?: string,
): string {
  if (typeof sessionOrType === "string") {
    const authType = sessionOrType;
    if (authType === "sparql-auth" && (username || password)) {
      return `Basic ${btoa(unescape(encodeURIComponent(`${username || ""}:${password || ""}`)))}`;
    }
    if (authType === "sparql-oauth" && token) {
      return token.startsWith("Bearer ") ? token : `Bearer ${token.trim()}`;
    }
    if (authType === "sparql-webid") {
      if (token) return token.startsWith("Bearer ") ? token : `Bearer ${token.trim()}`;
      if (webId) return `WebID ${webId.trim()}`;
    }
    return "";
  }
  const session = sessionOrType;
  if (session.authHeader) return session.authHeader;
  const authType = session.authType;
  const user = session.userName || session.username;
  const pass = session.password;
  const tok = session.oauthToken || session.token;
  const wid = session.webIdUri || session.webId;

  if (authType === "sparql-auth" && (user || pass)) {
    return `Basic ${btoa(unescape(encodeURIComponent(`${user || ""}:${pass || ""}`)))}`;
  }
  if (authType === "sparql-oauth" && tok) {
    return tok.startsWith("Bearer ") ? tok : `Bearer ${tok.trim()}`;
  }
  if (authType === "sparql-webid") {
    if (tok) return tok.startsWith("Bearer ") ? tok : `Bearer ${tok.trim()}`;
    if (wid) return `WebID ${wid.trim()}`;
  }
  return "";
}

/** Retire legacy credential-bearing cookies, never create new ones. */
export function clearLegacyMaestroSessionCookie(): void {
  if (typeof document !== "undefined") document.cookie = "maestro_session=; path=/; max-age=0; SameSite=Lax";
}

/** Save session locally (encrypted in localStorage if rememberMe is true, else sessionStorage). */
export async function savePersonalAuthSession(
  session: PersonalAuthSession,
  rememberMeOverride?: boolean,
  signal?: AbortSignal,
): Promise<void> {
  if (typeof window === "undefined") return;
  const isRemember = true; // Persist until explicit logout; session-only auth is no longer offered.
  const effectiveSession: PersonalAuthSession = {
    ...session,
    rememberMe: isRemember,
    username: session.username || session.userName,
    userName: session.userName || session.username,
    token: session.token || session.oauthToken,
    oauthToken: session.oauthToken || session.token,
    webId: session.webId || session.webIdUri,
    webIdUri: session.webIdUri || session.webId,
    displayName: session.displayName || session.userName || session.username || "",
    authHeader: buildAuthHeader(session),
  };

  const encryptedPassword = effectiveSession.password ? await encryptSecret(effectiveSession.password) : undefined;
  const encryptedToken = effectiveSession.token ? await encryptSecret(effectiveSession.token) : undefined;

  const { authHeader: _neverPersistHeader, ...persistable } = effectiveSession;
  const storagePayload = {
    ...persistable,
    password: encryptedPassword,
    token: encryptedToken,
    oauthToken: encryptedToken,
  };
  const serialized = JSON.stringify(storagePayload);

  if (signal?.aborted) throw new Error("Authentication initialization was cancelled before credentials were stored.");
  window.localStorage.setItem(STORAGE_KEY, serialized);
  disconnectedForThisPage = false;
  cachedAuthRaw = serialized; cachedAuthSession = effectiveSession;
  window.localStorage.setItem(AUTH_EXPECTED_KEY, "1");
  window.sessionStorage.removeItem(STORAGE_KEY);

  clearLegacyMaestroSessionCookie();
}

/** Restore stored session on page load. */
export async function loadPersonalAuthSession(): Promise<PersonalAuthSession | null> {
  if (typeof window === "undefined" || disconnectedForThisPage) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY) || window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) { cachedAuthRaw = null; cachedAuthSession = null; clearLegacyMaestroSessionCookie(); return null; }
  if (raw === cachedAuthRaw && cachedAuthSession) return cachedAuthSession;
  try {
    const parsed = JSON.parse(raw) as PersonalAuthSession;
    const decryptedPassword = parsed.password ? await decryptSecret(parsed.password) : undefined;
    const decryptedToken = parsed.token ? await decryptSecret(parsed.token) : undefined;

    const session: PersonalAuthSession = {
      ...parsed,
      graphPrefix: parsed.graphPrefix || (parsed as unknown as { graphsitePrefix?: string }).graphsitePrefix || "",
      username: parsed.username || parsed.userName,
      userName: parsed.userName || parsed.username,
      token: decryptedToken || parsed.token || parsed.oauthToken,
      oauthToken: decryptedToken || parsed.oauthToken || parsed.token,
      webId: parsed.webId || parsed.webIdUri,
      webIdUri: parsed.webIdUri || parsed.webId,
      password: decryptedPassword,
      authHeader: buildAuthHeader({ ...parsed, password: decryptedPassword, token: decryptedToken, oauthToken: decryptedToken }),
    };
    session.rememberMe = true;
    if (window.sessionStorage.getItem(STORAGE_KEY)) {
      // Migrate legacy session-only logins so the next browser restart retains them.
      await savePersonalAuthSession(session, true);
    } else {
      clearLegacyMaestroSessionCookie();
    }
    cachedAuthRaw = raw; cachedAuthSession = session;
    return session;
  } catch (error) {
    cachedAuthRaw = null; cachedAuthSession = null;
    browserLog.warn("auth.saved-session.decrypt-failed", error);
    return null;
  }
}

/** Clear active session from storage and cookies. */
export function clearPersonalAuthSession(): void {
  if (typeof window === "undefined") return;
  disconnectedForThisPage = false;
  cachedAuthRaw = null; cachedAuthSession = null;
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(AUTH_EXPECTED_KEY);
  window.sessionStorage.removeItem(STORAGE_KEY);
  clearLegacyMaestroSessionCookie();
  window.dispatchEvent(new Event("maestro:personal-session-cleared"));
}

/** Withdraw active personal capabilities without forgetting Alice's credentials.
 * The next page launch silently authenticates using the remembered record. */
export function disconnectPersonalAuthSession(): void {
  if (typeof window === "undefined") return;
  disconnectedForThisPage = true;
  cachedAuthRaw = null; cachedAuthSession = null;
  clearLegacyMaestroSessionCookie();
  window.dispatchEvent(new Event("maestro:personal-session-cleared"));
}
