"use client";
import { bootstrapHasMachines, currentBootstrapButtons, hydrateAuthBootstrap, refreshAuthBootstrap } from "@/lib/client-auth-bootstrap";
import { syncPersonalGraphList } from "@/lib/client-personal-graph-digest";
import { manageAppbarButtons } from "@/lib/client-appbar-buttons";
import { browserLog } from "@/lib/maestro-client-logging";
import { beginPersonalInitialization, cancelPersonalInitialization, isCurrentPersonalInitialization } from "@/lib/personal-initialization";


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
  const [loginPassword, setLoginPassword] = useState("");
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
import { testPersonalGraph, fetchWebIdProfile } from "@/lib/client-auth-probe";
import { seedPersonalGraphs } from "@/lib/client-graph-seed";
import { loadMaestroKinds, resetMaestroKinds } from "@/lib/client-kinds";

type AuthenticationActionDependencies = Pick<ReturnType<typeof useAuthenticationState>,
  "authSession" |
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
  const { authSession, loginTab, loginOauthProfileUrl, loginWebIdUri, setIsFetchingAvatar, setFetchedAvatarUrl, loginOauthUserName, setLoginOauthUserName, loginGraphStore, loginGraphPrefix, loginUsername, loginPassword, fetchedAvatarUrl, loginOauthToken, setLoginTesting, setLoginError, setLoginGraphStore, setLoginGraphPrefix, setLoginUsername, setLoginPassword, setPersonalPoliciesReady, setPersonalPoliciesSeedError, setAuthSession, setAuthRestoreIssue, setPersonalSparqlEndpoint, setLoginDialogOpen, setEndpointReloadRevision, setBookmarkCheckRevision } = deps;
  const loginRememberMe = true;
  const handleFetchProfile = async () => {
      const targetUrl = loginTab === "sparql-oauth" ? loginOauthProfileUrl.trim() : loginWebIdUri.trim();
      if (!targetUrl) return;
      setIsFetchingAvatar(true);
      try {
        const data = await fetchWebIdProfile(targetUrl);
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
        const data = await testPersonalGraph(session);
        if (!data.connected) {
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
      const attempt = beginPersonalInitialization();
      setLoginTesting(true);
      setLoginError("");
      try {
        const data = await testPersonalGraph(session, attempt.signal);
        if (!isCurrentPersonalInitialization(attempt)) return;
        if (!data.connected) {
          throw new Error(data.error || (data.status === 401 ? "Authentication failed: Invalid credentials or unauthorized." : "Could not connect to the personal graph server."));
        }
        // Block Record policy discovery before publishing the new login session.
        setPersonalPoliciesReady(false);
        setPersonalPoliciesSeedError("");
        // Persist verified upstream credentials for silent reconnects across browser restarts.
        await savePersonalAuthSession(session, loginRememberMe, attempt.signal);
        if (!isCurrentPersonalInitialization(attempt)) return;
        hydrateAuthBootstrap(session, data.bootstrap ?? []);
        setAuthSession(session);
        setAuthRestoreIssue(false);
        setPersonalSparqlEndpoint(session.graphStore);
        setLoginDialogOpen(false);
        toast.add({
          title: "Virtuoso authenticated",
          description: "Checking personal graph initialization and Status machines.",
          type: "info",
        });
  
        // Seed the manifest before requesting final policy verification. XState,
        // not this asynchronous action, owns the final readiness notification.
        try {
          await seedPersonalGraphs(attempt.signal);
          if (!isCurrentPersonalInitialization(attempt)) return;
          setPersonalPoliciesSeedError("");
          // A successful graph write is NOT final initialization success.
          // Only the access XState actor may publish the verified-ready toast.
          // Kinds is a regular, one-time RDF → TS projection. A provider read
          // failure must not invalidate unrelated personal policy availability.
          // Provision first-login shortcuts after seed, then refresh only the
          // bootstrap datasets changed by seeding/provisioning.
          await manageAppbarButtons({action:"ensure-providers"});
          if (!isCurrentPersonalInitialization(attempt)) return;
          await refreshAuthBootstrap(session, attempt.signal);
          if (!isCurrentPersonalInitialization(attempt)) return;
          // Only after required bootstrap and seed have completed may the
          // existing XState machine-definition verification start.
          setPersonalPoliciesReady(true);
          try { resetMaestroKinds(); await loadMaestroKinds(); }
          catch (kindsError) {
            if (!isCurrentPersonalInitialization(attempt)) return;
            toast.add({ title: "Kinds patterns unavailable", description: kindsError instanceof Error ? kindsError.message : "Could not read Kinds RDF.", type: "warning" });
          }
        } catch (seedError) {
          if (!isCurrentPersonalInitialization(attempt)) return;
          setPersonalPoliciesReady(false);
          setPersonalPoliciesSeedError(seedError instanceof Error ? seedError.message : "Personal graph seeding failed.");
          // XState receives the exact seed/bootstrap error and owns the visible failure.
        }
  
        // A late Kinds read may complete after Disconnect or account switch.
        if (!isCurrentPersonalInitialization(attempt)) return;
        // Login only changes personal/write capabilities and rechecks the
        // optional courtesy digest. Never evict cached public read results.
        setEndpointReloadRevision((r) => r + 1);
        setBookmarkCheckRevision((r) => r + 1);
        // Optional graph synchronization has independent timeout/error handling.
        void syncPersonalGraphList().catch(error=>
          browserLog.warn("auth.graph-digest.sync-failed",error));
      } catch (err) {
        if (!isCurrentPersonalInitialization(attempt)) return;
        const msg = err instanceof Error ? err.message : "Login failed";
        setLoginError(msg);
        toast.add({ title: "Login failed", description: msg, type: "error" });
      } finally {
        if (isCurrentPersonalInitialization(attempt)) setLoginTesting(false);
      }
    };
  /** Retry required personal initialization without replacing the authenticated
   * identity, stored credentials, live FCT query, or XState policy gate. */
  const handleRetryPersonalInitialization = async () => {
    if (!authSession) return;
    const attempt = beginPersonalInitialization();
    setPersonalPoliciesReady(false);
    setPersonalPoliciesSeedError("");
    try {
      await seedPersonalGraphs(attempt.signal);
      if (!isCurrentPersonalInitialization(attempt)) return;
      await manageAppbarButtons({action:"ensure-providers"});
      if (!isCurrentPersonalInitialization(attempt)) return;
      await refreshAuthBootstrap(authSession,attempt.signal);
      if (!isCurrentPersonalInitialization(attempt)) return;
      setPersonalPoliciesReady(true); // XState must independently verify.
    } catch (error) {
      if (!isCurrentPersonalInitialization(attempt)) return;
      setPersonalPoliciesSeedError(error instanceof Error ? error.message : "Personal initialization retry failed.");
      setPersonalPoliciesReady(false);
    }
  };
  return { handleFetchProfile, handleTestConnection, handleLoginSubmit, handleRetryPersonalInitialization };
}

import { useEffect } from "react";
import { loadPersonalAuthSession, AUTH_EXPECTED_KEY } from "@/lib/personal-auth";

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
  "setAuthRestoreComplete" |
  "setPersonalPoliciesReady" | "setPersonalPoliciesSeedError"
> & { setPersonalSparqlEndpoint: Dispatch<SetStateAction<string>> };

/** Restore login before endpoint discovery; renew only a previously authenticated session. */
export function useAuthenticationSessionLifecycle(deps: AuthenticationLifecycleDependencies) {
  const { authSession, setAuthSession, setAuthRestoreIssue, setLoginGraphStore, setPersonalSparqlEndpoint, setLoginGraphPrefix, setLoginTab, setLoginUsername, setLoginPassword, setLoginOauthToken, setLoginOauthProfileUrl, setLoginOauthUserName, setLoginWebIdUri, setFetchedAvatarUrl, setAuthRestoreComplete, setPersonalPoliciesReady, setPersonalPoliciesSeedError } = deps;
  useEffect(() => {
      const attempt = beginPersonalInitialization();
      void (async () => {
        try {
          const session = await loadPersonalAuthSession();
          if (!isCurrentPersonalInitialization(attempt)) return;
          if (session) {
            setPersonalPoliciesReady(false);
            setAuthSession(session);
            setAuthRestoreIssue(false);
            // Restore authentication and XState maps silently. Browse URL
            // restoration is entirely independent of this async work.
            void (async()=>{
              try {
                await refreshAuthBootstrap(session, attempt.signal);
                if (!isCurrentPersonalInitialization(attempt)) return;
                let changed=false;
                if (!bootstrapHasMachines()) {
                  await seedPersonalGraphs(attempt.signal);
                  if (!isCurrentPersonalInitialization(attempt)) return;
                  changed=true;
                }
                if (!currentBootstrapButtons().length) {
                  await manageAppbarButtons({action:"ensure-providers"});
                  if (!isCurrentPersonalInitialization(attempt)) return;
                  changed=true;
                }
                if (changed) await refreshAuthBootstrap(session, attempt.signal);
                if (!isCurrentPersonalInitialization(attempt)) return;
                setPersonalPoliciesSeedError("");
                setPersonalPoliciesReady(true);
                void syncPersonalGraphList().catch(error=>
                  browserLog.warn("auth.graph-digest.restore-failed",error));
              } catch (error) {
                if (!isCurrentPersonalInitialization(attempt)) return;
                const reason=error instanceof Error?error.message:"Could not restore personal authentication.";
                setPersonalPoliciesSeedError(reason);
                setPersonalPoliciesReady(false);
                browserLog.warn("auth.personal-bootstrap.restore-failed",error);
              }
            })();
            void loadMaestroKinds().catch(error => browserLog.warn("kinds.personal-rdf.restore-failed", error));
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
          if (isCurrentPersonalInitialization(attempt) && !session && window.localStorage.getItem(AUTH_EXPECTED_KEY) === "1") {
            // A previous login existed, but the remembered credentials could not be restored. Keep the user informed.
            setAuthRestoreIssue(true);
          }
          // Not logged in: the page loads as usual, with no personal graph server logic (no History, Bookmarks, or store access).
        } catch (err) {
          if (!isCurrentPersonalInitialization(attempt)) return;
          browserLog.warn("auth.personal-session.restore-failed", err);
          if (window.localStorage.getItem(AUTH_EXPECTED_KEY) === "1") setAuthRestoreIssue(true);
        } finally {
          // Storage hydration has completed; no proxy-side session exists.
          if (isCurrentPersonalInitialization(attempt)) setAuthRestoreComplete(true);
        }
      })();
      return () => { if (isCurrentPersonalInitialization(attempt)) cancelPersonalInitialization(); };
    }, []);
  

}
