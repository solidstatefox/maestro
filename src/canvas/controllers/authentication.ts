"use client";

import { useRef, useState } from "react";
import type { AuthType, PersonalAuthSession } from "@/lib/personal-auth";

/** State owned by the authentication subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useAuthenticationState() {
  const [authSession, setAuthSession] = useState<PersonalAuthSession | null>(null);
  const [personalPoliciesReady, setPersonalPoliciesReady] = useState(true);
  const [personalPoliciesSeedError, setPersonalPoliciesSeedError] = useState("");
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [authRestoreIssue, setAuthRestoreIssue] = useState(false);
  const [authRestoreComplete, setAuthRestoreComplete] = useState(false);
  const [loginTab, setLoginTab] = useState<AuthType>("sparql-auth");
  const [loginGraphStore, setLoginGraphStore] = useState("http://demo.openlinksw.com/sparql");
  const [loginGraphPrefix, setLoginGraphPrefix] = useState("http://demo.openlinksw.com/ods/home/acme");
  const [loginUsername, setLoginUsername] = useState("acme");
  const [loginPassword, setLoginPassword] = useState("123456");
  const [loginShowPassword, setLoginShowPassword] = useState(false);
  const [loginOauthToken, setLoginOauthToken] = useState("");
  const [loginOauthProfileUrl, setLoginOauthProfileUrl] = useState("");
  const [loginOauthUserName, setLoginOauthUserName] = useState("");
  const [loginWebIdUri, setLoginWebIdUri] = useState("");
  const [loginTesting, setLoginTesting] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isFetchingAvatar, setIsFetchingAvatar] = useState(false);
  const [fetchedAvatarUrl, setFetchedAvatarUrl] = useState<string | null>(null);

  return {
    authSession,
    setAuthSession,
    personalPoliciesReady,
    setPersonalPoliciesReady,
    personalPoliciesSeedError,
    setPersonalPoliciesSeedError,
    loginDialogOpen,
    setLoginDialogOpen,
    authRestoreIssue,
    setAuthRestoreIssue,
    authRestoreComplete,
    setAuthRestoreComplete,
    loginTab,
    setLoginTab,
    loginGraphStore,
    setLoginGraphStore,
    loginGraphPrefix,
    setLoginGraphPrefix,
    loginUsername,
    setLoginUsername,
    loginPassword,
    setLoginPassword,
    loginShowPassword,
    setLoginShowPassword,
    loginOauthToken,
    setLoginOauthToken,
    loginOauthProfileUrl,
    setLoginOauthProfileUrl,
    loginOauthUserName,
    setLoginOauthUserName,
    loginWebIdUri,
    setLoginWebIdUri,
    loginTesting,
    setLoginTesting,
    loginError,
    setLoginError,
    isFetchingAvatar,
    setIsFetchingAvatar,
    fetchedAvatarUrl,
    setFetchedAvatarUrl,
  };
}

import type { Dispatch, SetStateAction, MouseEvent, FormEvent } from "react";
import { buildAuthHeader, graphForPrefix, savePersonalAuthSession } from "@/lib/personal-auth";
import { toast } from "@/components/ui/toast";
import { proxyDebugHeaders } from "@/lib/proxy-debug";
import { clearClientQueryCache } from "@/lib/client-query-cache";

type AuthenticationActionDependencies = Pick<ReturnType<typeof useAuthenticationState>,
  "loginTab" |
  "loginOauthProfileUrl" |
  "loginWebIdUri" |
  "setIsFetchingAvatar" |
  "setFetchedAvatarUrl" |
  "loginOauthUserName" |
  "setLoginOauthUserName" |
  "loginGraphStore" |
  "loginGraphPrefix" |
  "loginUsername" |
  "loginPassword" |
  "fetchedAvatarUrl" |
  "loginOauthToken" |
  "setLoginTesting" |
  "setLoginError" |
  "setLoginGraphStore" |
  "setLoginGraphPrefix" |
  "setLoginUsername" |
  "setLoginPassword" |
  "setPersonalPoliciesReady" |
  "setPersonalPoliciesSeedError" |
  "setAuthSession" |
  "setAuthRestoreIssue" |
  "setLoginDialogOpen"
> & {
  setPersonalSparqlEndpoint: Dispatch<SetStateAction<string>>;
  setEndpointReloadRevision: Dispatch<SetStateAction<number>>;
  setBookmarkCheckRevision: Dispatch<SetStateAction<number>>;
};

/** All login, profile and policy-seeding operations belong to authentication. */
export function createAuthenticationActions(deps: AuthenticationActionDependencies) {
  const { loginTab, loginOauthProfileUrl, loginWebIdUri, setIsFetchingAvatar, setFetchedAvatarUrl, loginOauthUserName, setLoginOauthUserName, loginGraphStore, loginGraphPrefix, loginUsername, loginPassword, fetchedAvatarUrl, loginOauthToken, setLoginTesting, setLoginError, setLoginGraphStore, setLoginGraphPrefix, setLoginUsername, setLoginPassword, setPersonalPoliciesReady, setPersonalPoliciesSeedError, setAuthSession, setAuthRestoreIssue, setPersonalSparqlEndpoint, setLoginDialogOpen, setEndpointReloadRevision, setBookmarkCheckRevision } = deps;
  const loginRememberMe = true;
  const handleFetchProfile = async () => {
      const targetUrl = loginTab === "sparql-oauth" ? loginOauthProfileUrl.trim() : loginWebIdUri.trim();
      if (!targetUrl) return;
      setIsFetchingAvatar(true);
      try {
        const response = await fetch("/proxy/api/service?service=maestro&operationId=auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "profile", profileUrl: targetUrl }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to fetch profile");
        if (data.avatarUrl) {
          setFetchedAvatarUrl(data.avatarUrl);
          toast.add({ title: "Avatar detected", description: "Successfully retrieved avatar image from profile.", type: "success" });
        }
        if (data.displayName && loginTab === "sparql-oauth" && !loginOauthUserName) {
          setLoginOauthUserName(data.displayName);
        }
      } catch (err) {
        toast.add({ title: "Could not fetch profile", description: err instanceof Error ? err.message : "Profile lookup failed", type: "error" });
      } finally {
        setIsFetchingAvatar(false);
      }
    };
  
    /** Live values from the login <form>; browsers can autofill fields without firing React onChange. */
    type LoginFormValues = { graphStore?: string; graphPrefix?: string; username?: string; password?: string };
    const readLoginFormValues = (form: HTMLFormElement | null): LoginFormValues => {
      if (!form) return {};
      const data = new FormData(form);
      const text = (name: string) => (data.has(name) ? String(data.get(name) ?? "") : undefined);
      return { graphStore: text("graph_store"), graphPrefix: text("graph_prefix"), username: text("username"), password: text("password") };
    };
  
    const buildCurrentSession = (form: LoginFormValues = {}): PersonalAuthSession => {
      const formGraphStore = form.graphStore ?? loginGraphStore;
      const formGraphPrefix = form.graphPrefix ?? loginGraphPrefix;
      const formUsername = form.username ?? loginUsername;
      const formPassword = form.password ?? loginPassword;
      let userName = "";
      let authHeader = "";
      let avatarUrl: string | undefined = undefined;
  
      if (loginTab === "sparql-auth") {
        userName = formUsername.trim() || "acme";
        const user = formUsername.trim();
        const pass = formPassword;
        if (user || pass) {
          authHeader = buildAuthHeader("sparql-auth", user, pass);
        }
        avatarUrl = undefined;
      } else if (loginTab === "sparql-oauth") {
        userName = loginOauthUserName.trim() || "OAuth User";
        const token = loginOauthToken.trim();
        if (token) {
          authHeader = buildAuthHeader("sparql-oauth", undefined, undefined, token);
        }
        avatarUrl = fetchedAvatarUrl || undefined;
      } else if (loginTab === "sparql-webid") {
        const uri = loginWebIdUri.trim();
        userName = uri.split("#").pop() || uri.split("/").filter(Boolean).pop() || "WebID User";
        const token = loginOauthToken.trim();
        authHeader = buildAuthHeader("sparql-webid", undefined, undefined, token, undefined, uri);
        avatarUrl = fetchedAvatarUrl || undefined;
      }
  
      return {
        authType: loginTab,
        graphStore: formGraphStore.trim() || "http://demo.openlinksw.com/sparql",
        graphPrefix: formGraphPrefix.trim() || "http://demo.openlinksw.com/ods/home/acme",
        userName,
        password: loginTab === "sparql-auth" ? formPassword : undefined,
        authHeader,
        oauthToken: loginTab === "sparql-oauth" ? loginOauthToken.trim() : (loginTab === "sparql-webid" ? loginOauthToken.trim() : undefined),
        oauthProfileUrl: loginTab === "sparql-oauth" ? loginOauthProfileUrl.trim() : undefined,
        webIdUri: loginTab === "sparql-webid" ? loginWebIdUri.trim() : undefined,
        avatarUrl,
        rememberMe: loginRememberMe,
      };
    };
  
    const handleTestConnection = async (event?: MouseEvent<HTMLButtonElement>) => {
      const session = buildCurrentSession(readLoginFormValues(event?.currentTarget.form ?? null));
      setLoginTesting(true);
      setLoginError("");
      try {
        const response = await fetch("/proxy/api/service?service=maestro&operationId=auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "test",
            authType: session.authType,
            graphStore: session.graphStore,
            authHeader: session.authHeader,
            graphPrefix: session.graphPrefix,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.connected) {
          throw new Error(data.error || "Connection test failed");
        }
        toast.add({
          title: "Connection test succeeded",
          description: `Connected to personal graph server (HTTP ${data.status}). History graph: ${graphForPrefix(session.graphPrefix)}`,
          type: "success",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Connection failed";
        setLoginError(msg);
        toast.add({ title: "Connection failed", description: msg, type: "error" });
      } finally {
        setLoginTesting(false);
      }
    };
  
    const handleLoginSubmit = async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formValues = readLoginFormValues(e.currentTarget);
      // Keep React state in step with what is actually in the fields.
      if (formValues.graphStore !== undefined) setLoginGraphStore(formValues.graphStore);
      if (formValues.graphPrefix !== undefined) setLoginGraphPrefix(formValues.graphPrefix);
      if (formValues.username !== undefined) setLoginUsername(formValues.username);
      if (formValues.password !== undefined) setLoginPassword(formValues.password);
      const session = buildCurrentSession(formValues);
      setLoginTesting(true);
      setLoginError("");
      try {
        const response = await fetch("/proxy/api/service?service=maestro&operationId=auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "test",
            authType: session.authType,
            graphStore: session.graphStore,
            authHeader: session.authHeader,
            graphPrefix: session.graphPrefix,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.connected) {
          throw new Error(data.error || (data.status === 401 ? "Authentication failed: Invalid credentials or unauthorized." : "Could not connect to the personal graph server."));
        }
        // Block Record policy discovery before publishing the new login session.
        setPersonalPoliciesReady(false);
        setPersonalPoliciesSeedError("");
        // Persist the session first: this also sets the maestro_session cookie the proxy routes read.
        await savePersonalAuthSession(session, loginRememberMe);
        setAuthSession(session);
        setAuthRestoreIssue(false);
        setPersonalSparqlEndpoint(session.graphStore);
        setLoginDialogOpen(false);
        toast.add({
          title: "Connected",
          description: `Logged in as ${session.userName}. History set to ${graphForPrefix(session.graphPrefix)}`,
          type: "success",
        });
  
        // As soon as login succeeds, load every ./graph document into <graph>/query + manifest fragment.
        try {
          const seedResponse = await fetch("/proxy/api/service?service=maestro&operationId=graph-seed", { method: "POST", cache: "no-store", headers: proxyDebugHeaders("login-graph-seed", "Login") });
          const seedData = await seedResponse.json().catch(() => ({}));
          if (!seedResponse.ok || !seedData.ok) throw new Error(seedData.error || `Graph load failed (HTTP ${seedResponse.status})`);
          setPersonalPoliciesSeedError("");
          setPersonalPoliciesReady(true);
          toast.add({
            title: "Graphs loaded",
            description: `Loaded ${Array.isArray(seedData.loaded) ? seedData.loaded.length : 0} RDF documents into ${graphForPrefix(session.graphPrefix)}.`,
            type: "success",
          });
        } catch (seedError) {
          setPersonalPoliciesReady(false);
          setPersonalPoliciesSeedError(seedError instanceof Error ? seedError.message : "Personal graph seeding failed.");
          toast.add({ title: "Could not load ./graph into your graph server", description: seedError instanceof Error ? seedError.message : "Graph load failed", type: "error" });
        }
  
        // Drop cached Datasite lists from before login and reload them from the personal store.
        await clearClientQueryCache();
        setEndpointReloadRevision((r) => r + 1);
        setBookmarkCheckRevision((r) => r + 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Login failed";
        setLoginError(msg);
        toast.add({ title: "Login failed", description: msg, type: "error" });
      } finally {
        setLoginTesting(false);
      }
    };
  return { handleFetchProfile, handleTestConnection, handleLoginSubmit };
}

import { useEffect } from "react";
import { loadPersonalAuthSession, setMaestroSessionCookie, AUTH_EXPECTED_KEY } from "@/lib/personal-auth";

type AuthenticationLifecycleDependencies = Pick<ReturnType<typeof useAuthenticationState>,
  "authSession" |
  "setAuthSession" |
  "setAuthRestoreIssue" |
  "setLoginGraphStore" |
  "setLoginGraphPrefix" |
  "setLoginTab" |
  "setLoginUsername" |
  "setLoginPassword" |
  "setLoginOauthToken" |
  "setLoginOauthProfileUrl" |
  "setLoginOauthUserName" |
  "setLoginWebIdUri" |
  "setFetchedAvatarUrl" |
  "setAuthRestoreComplete"
> & { setPersonalSparqlEndpoint: Dispatch<SetStateAction<string>> };

/** Restore login before endpoint discovery; renew only a previously authenticated session. */
export function useAuthenticationSessionLifecycle(deps: AuthenticationLifecycleDependencies) {
  const { authSession, setAuthSession, setAuthRestoreIssue, setLoginGraphStore, setPersonalSparqlEndpoint, setLoginGraphPrefix, setLoginTab, setLoginUsername, setLoginPassword, setLoginOauthToken, setLoginOauthProfileUrl, setLoginOauthUserName, setLoginWebIdUri, setFetchedAvatarUrl, setAuthRestoreComplete } = deps;
  useEffect(() => {
      void (async () => {
        try {
          const session = await loadPersonalAuthSession();
          if (session) {
            setAuthSession(session);
            setAuthRestoreIssue(false);
            if (session.graphStore) {
              setLoginGraphStore(session.graphStore);
              setPersonalSparqlEndpoint(session.graphStore);
            }
            if (session.graphPrefix) setLoginGraphPrefix(session.graphPrefix);
            setLoginTab(session.authType);
            if (session.authType === "sparql-auth") {
              if (session.userName) setLoginUsername(session.userName);
              if (session.password) setLoginPassword(session.password);
            } else if (session.authType === "sparql-oauth") {
              if (session.oauthToken) setLoginOauthToken(session.oauthToken);
              if (session.oauthProfileUrl) setLoginOauthProfileUrl(session.oauthProfileUrl);
              if (session.userName) setLoginOauthUserName(session.userName);
            } else if (session.authType === "sparql-webid") {
              if (session.webIdUri) setLoginWebIdUri(session.webIdUri);
              if (session.oauthToken) setLoginOauthToken(session.oauthToken);
            }
            if (session.avatarUrl) setFetchedAvatarUrl(session.avatarUrl);
            // The initial menu load waits for session restoration. A browser
            // refresh is not a new login and must not trigger another load.
          }
          if (!session && window.localStorage.getItem(AUTH_EXPECTED_KEY) === "1") {
            // A previous login should exist, but neither persisted credentials nor
            // the long-lived proxy cookie could be restored. Keep the user informed.
            setAuthRestoreIssue(true);
          }
          // Not logged in: the page loads as usual, with no personal graph server logic (no History, Bookmarks, or store access).
        } catch (err) {
          console.warn("Could not load personal graph auth session", err);
          if (window.localStorage.getItem(AUTH_EXPECTED_KEY) === "1") setAuthRestoreIssue(true);
        } finally {
          // Only now may the registry be read. The session cookie has either
          // been restored or we've established this is an anonymous session.
          setAuthRestoreComplete(true);
        }
      })();
    }, []);
  
    // Renew the existing authenticated proxy cookie while the page stays open.
    // Never create a session here: only a restored or explicitly logged-in session qualifies.
    useEffect(() => {
      if (!authSession) return;
      const renew = () => setMaestroSessionCookie(authSession);
      window.addEventListener("focus", renew);
      document.addEventListener("visibilitychange", renew);
      // Keep the existing login cookie alive during a long-lived active Maestro tab.
      // This does not extend an OAuth token's provider-defined expiry or create a new login.
      const renewalTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") renew();
      }, 10 * 60 * 1000);
      return () => {
        window.clearInterval(renewalTimer);
        window.removeEventListener("focus", renew);
        document.removeEventListener("visibilitychange", renew);
      };
    }, [authSession]);
}
