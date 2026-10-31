/**
 * Personal Graph Server Authentication & Session Management.
 * Supports Virtuoso's sparql-auth, sparql-oauth, and sparql-webid protocols.
 * Encrypts sensitive credentials locally in browser storage.
 */

export type AuthType = "sparql-auth" | "sparql-oauth" | "sparql-webid";

export interface PersonalAuthSession {
  authType: AuthType;
  graphStore: string;
  graphsitePrefix: string;
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

export interface PublicSessionPayload {
  graphStore: string;
  graphsitePrefix: string;
  authType: AuthType;
  authHeader?: string;
  userName?: string;
  userAvatar?: string;
}

const STORAGE_KEY = "maestro_personal_auth_v1";
const DEVICE_KEY_NAME = "maestro_device_salt";
const COOKIE_NAME = "maestro_session";

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
  if (typeof window === "undefined" || !window.crypto?.subtle) return btoa(plainText);
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
    return btoa(plainText);
  }
}

/** Decrypt AES-GCM ciphertext from storage. */
export async function decryptSecret(cipherBase64: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    try { return atob(cipherBase64); } catch { return ""; }
  }
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
    try { return atob(cipherBase64); } catch { return ""; }
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

/** Update the browser session cookie so all proxy routes receive the personal graph credentials. */
export function setMaestroSessionCookie(session: PersonalAuthSession | null) {
  if (typeof document === "undefined") return;
  if (!session) {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
    return;
  }
  const payload: PublicSessionPayload = {
    graphStore: session.graphStore,
    graphsitePrefix: session.graphsitePrefix,
    authType: session.authType,
    authHeader: buildAuthHeader(session) || undefined,
    userName: session.displayName || session.userName || session.username,
    userAvatar: session.avatarUrl,
  };
  const maxAge = session.rememberMe ? 60 * 60 * 24 * 30 : ""; // 30 days or session
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(payload))}; path=/; SameSite=Lax; ${maxAge ? `max-age=${maxAge}` : ""}`;
}

/** Save session locally (encrypted in localStorage if rememberMe is true, else sessionStorage). */
export async function savePersonalAuthSession(
  session: PersonalAuthSession,
  rememberMeOverride?: boolean,
): Promise<void> {
  if (typeof window === "undefined") return;
  const isRemember = rememberMeOverride !== undefined ? rememberMeOverride : session.rememberMe;
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
    authHeader: session.authHeader || buildAuthHeader(session),
  };

  const encryptedPassword = effectiveSession.password ? await encryptSecret(effectiveSession.password) : undefined;
  const encryptedToken = effectiveSession.token ? await encryptSecret(effectiveSession.token) : undefined;

  const storagePayload = {
    ...effectiveSession,
    password: encryptedPassword,
    token: encryptedToken,
    oauthToken: encryptedToken,
  };
  const serialized = JSON.stringify(storagePayload);

  if (isRemember) {
    window.localStorage.setItem(STORAGE_KEY, serialized);
    window.sessionStorage.removeItem(STORAGE_KEY);
  } else {
    window.sessionStorage.setItem(STORAGE_KEY, serialized);
    window.localStorage.removeItem(STORAGE_KEY);
  }

  setMaestroSessionCookie(effectiveSession);
}

/** Restore stored session on page load. */
export async function loadPersonalAuthSession(): Promise<PersonalAuthSession | null> {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersonalAuthSession;
    const decryptedPassword = parsed.password ? await decryptSecret(parsed.password) : undefined;
    const decryptedToken = parsed.token ? await decryptSecret(parsed.token) : undefined;

    const session: PersonalAuthSession = {
      ...parsed,
      username: parsed.username || parsed.userName,
      userName: parsed.userName || parsed.username,
      token: decryptedToken || parsed.token || parsed.oauthToken,
      oauthToken: decryptedToken || parsed.oauthToken || parsed.token,
      webId: parsed.webId || parsed.webIdUri,
      webIdUri: parsed.webIdUri || parsed.webId,
      password: decryptedPassword,
      authHeader: parsed.authHeader || buildAuthHeader(parsed),
    };
    setMaestroSessionCookie(session);
    return session;
  } catch (error) {
    console.warn("Could not decrypt saved personal graph server session", error);
    return null;
  }
}

/** Clear active session from storage and cookies. */
export function clearPersonalAuthSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.sessionStorage.removeItem(STORAGE_KEY);
  setMaestroSessionCookie(null);
}
