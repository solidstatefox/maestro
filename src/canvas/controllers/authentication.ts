"use client";
import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { restoreDigestSession, disconnectDigestSession, ensureDigestSession, subscribeDigestSessionChanges, requestDigestPersistence, withSessionInitializationLock, readSessionHydration, commitSessionSnapshot, restoredDigestSession } from "@/lib/client-digest-session";
import { type PersonalInitialization, type PersonalInitializationController } from "@/lib/app-lifecycle/personal-initialization-machine";
import { refreshAuthBootstrap, hydrateAuthBootstrap } from "@/lib/client-auth-bootstrap";
import { loadMaestroKinds, resetMaestroKinds, restoreSessionKinds, currentSessionKinds } from "@/lib/client-kinds";
import { listPersonalGraphServers, asEndpointOption, PERSONAL_SERVERS_CHANGED } from "@/lib/client-personal-graph-servers";
import { rememberPersonalGraphServers } from "@/lib/graph-server-startup";
import type { EndpointOption } from "@/canvas/top/appbar";
import type { FormEvent } from "react";
import { graphForPrefix, personalWriteEndpoint, type AuthType, type PersonalAuthSession } from "@/lib/personal-auth";
import { preparePersonalSeed, seedPersonalGraphs, type SeedPlan } from "@/lib/client-graph-seed";
import type { PersonalRows } from "@/lib/client-personal-sparql";
import { loginConnectionMessage } from "@/lib/login-connection-error";
import { hydratePersonalHttpOutcome } from "@/lib/personal-session-hint";

/** Existing login dialog and XState user-session interfaces. */
export function useAuthenticationState() {
  const [authSession, setAuthSession] = useState<PersonalAuthSession | null>(null);
  const [personalPoliciesReady, setPersonalPoliciesReady] = useState(false);
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
    loginError,
    setLoginError,
    isFetchingAvatar,
    setIsFetchingAvatar,
    fetchedAvatarUrl,
    setFetchedAvatarUrl,
  };
}


type AuthenticationActionDependencies = AuthenticationLifecycleDependencies & Pick<ReturnType<typeof useAuthenticationState>,
  "loginTab" | "loginGraphStore" | "loginGraphPrefix" | "loginUsername" | "loginPassword"
> & {onConnectHttpStatus:(status:number)=>void;onConnectChallengeSent:()=>void;personalInitialization:PersonalInitializationController};
export function createAuthenticationActions(deps: AuthenticationActionDependencies) {
  return {
    handleFetchProfile: async (): Promise<void> => {},
    handleTestConnection: async (): Promise<void> => {},
    handleLoginSubmit: async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      requestDigestPersistence();
      deps.setLoginError("");
      await deps.personalInitialization.run(`connect|${deps.loginGraphStore}|${deps.loginGraphPrefix}|${deps.loginUsername}`, async attempt => {
        try {
          if(deps.loginTab!=="sparql-auth")throw new Error("Only SPARQL Digest is supported.");
          const restored=await withSessionInitializationLock(attempt.signal,async()=>{
            const plan=await preparePersonalSeed(deps.loginGraphPrefix.trim(),attempt.signal);
            const bindings=await ensureDigestSession({username:deps.loginUsername,graphStore:deps.loginGraphStore,
              graphPrefix:deps.loginGraphPrefix,password:deps.loginPassword},attempt.signal,status=>{
                if(!attempt.signal.aborted)deps.onConnectHttpStatus(status);
              },plan.query,()=>{
                if(!attempt.signal.aborted)deps.onConnectChallengeSent();
              });
            if(attempt.signal.aborted)return false;
            deps.setLoginPassword("");
            return initializeUserSession(deps,attempt,bindings ? plan : undefined,bindings);
          });
          if(attempt.signal.aborted)return false;
          if(!restored && !restoredDigestSession())throw new Error("The saved personal user session could not be restored.");
          if(restored)deps.setLoginDialogOpen(false);
          return restored;
        }catch(error){
          if(!attempt.signal.aborted){
            deps.setAuthRestoreComplete(true);
            const message=await loginConnectionMessage(error,attempt.signal);
            if(!attempt.signal.aborted)deps.setLoginError(message);
          }
          return false;
        }
      }, "connect");
    },
    handleRetryPersonalInitialization: async (): Promise<void> => {
      // A retry never disconnects the healthy Digest carrier, invalidates
      // nonce state, or clears the authoritative authenticated session.
      const session=restoredDigestSession();
      const key=session ? `${session.graphStore}|${session.graphPrefix}|${session.username??""}` : "restore";
      await deps.personalInitialization.run(`retry|${key}`,async attempt=>{
        deps.setPersonalPoliciesReady(false);
        deps.setPersonalPoliciesSeedError("");
        return restoreUserSession(deps,attempt);
      });
    },
  };
}

type AuthenticationLifecycleDependencies = Pick<ReturnType<typeof useAuthenticationState>,
  "authSession" | "setAuthSession" | "setAuthRestoreIssue" | "setLoginGraphStore" | "setLoginGraphPrefix" |
  "setLoginTab" | "setLoginUsername" | "setLoginPassword" | "setLoginOauthToken" | "setLoginOauthProfileUrl" |
  "setLoginOauthUserName" | "setLoginWebIdUri" | "setFetchedAvatarUrl" | "setAuthRestoreComplete" |
  "setPersonalPoliciesReady" | "setPersonalPoliciesSeedError" | "setLoginDialogOpen" | "setLoginError"
> & {setPersonalSparqlEndpoint:Dispatch<SetStateAction<string>>;setManagedEndpoints:Dispatch<SetStateAction<EndpointOption[]>>};

const verifiedSeedRevisions=new WeakMap<PersonalAuthSession,string>();
/** One restoration path for URL load and Connect. Existing XState observes the session. */
export async function restoreUserSession(deps:AuthenticationLifecycleDependencies,attempt:PersonalInitialization):Promise<boolean> {
  try{return await withSessionInitializationLock(attempt.signal,()=>initializeUserSession(deps,attempt));}catch(error){
    if(!attempt.signal.aborted){deps.setAuthRestoreComplete(true);deps.setPersonalPoliciesSeedError(error instanceof Error?error.message:"Personal store initialization failed.");}
    throw error;
  }
}
async function initializeUserSession(deps:AuthenticationLifecycleDependencies,attempt:PersonalInitialization,plan?:SeedPlan,bindings?:PersonalRows):Promise<boolean> {
  const session=await restoreDigestSession(attempt.signal);
  if(attempt.signal.aborted)return false;
  if(!session){deps.setAuthRestoreComplete(true);return false;}
  resetMaestroKinds();
  deps.setPersonalPoliciesReady(false);
  deps.setPersonalPoliciesSeedError("");
  deps.setAuthSession(session);
  deps.setLoginGraphStore(session.graphStore);
  deps.setLoginGraphPrefix(session.graphPrefix);
  deps.setLoginUsername(session.username??"");
  deps.setPersonalSparqlEndpoint(session.graphStore);
  deps.setAuthRestoreComplete(true);
  try{
    const saved=await readSessionHydration(session);
    if(attempt.signal.aborted)return false;
    if(saved.httpOutcome)hydratePersonalHttpOutcome(session,saved.httpOutcome);
    // Directory data is presentation-only; a saved snapshot cannot establish
    // policy readiness. Reuse it while the authenticated seed check runs.
    if(saved.snapshot)deps.setManagedEndpoints(saved.snapshot.servers.map(asEndpointOption));
    const seed=await seedPersonalGraphs(attempt.signal,plan,bindings).catch(error=>{throw new Error(`Graph seed: ${error instanceof Error?error.message:String(error)}`);});
    if(attempt.signal.aborted)return false;
    let entries;
    if(saved.snapshot?.seedRevision===seed.revision && !seed.changedGraphs.length){
      const base=graphForPrefix(session.graphPrefix);
      hydrateAuthBootstrap(session,saved.snapshot.bindings,saved.snapshot.buttons);
      restoreSessionKinds(`${base}@${personalWriteEndpoint(session)}`,base,saved.snapshot.kinds);
      entries=saved.snapshot.servers;
    }else{
      const completeBindings=await refreshAuthBootstrap(session,attempt.signal).catch(error=>{throw new Error(`Bootstrap: ${error instanceof Error?error.message:String(error)}`);});
      if(attempt.signal.aborted)return false;
      await loadMaestroKinds(attempt.signal,"personal-initialization").catch(error=>{throw new Error(`Kinds: ${error instanceof Error?error.message:String(error)}`);});
      if(attempt.signal.aborted)return false;
      entries=await listPersonalGraphServers(attempt.signal,"personal-initialization").catch(error=>{throw new Error(`Personal graph directory: ${error instanceof Error?error.message:String(error)}`);});
      if(attempt.signal.aborted)return false;
      await commitSessionSnapshot(session,{bindings:completeBindings,kinds:currentSessionKinds(),servers:entries,completedAt:Date.now(),seedRevision:seed.revision},attempt.signal);
    }
    // hydrateAuthBootstrap (including refreshAuthBootstrap) compiles and verifies
    // every required target before priming the runtime cache. A fresh seed digest
    // check above establishes whether the verified saved snapshot is reusable.
    // Do not invalidate that cache and issue a second authenticated SELECT.
    if(attempt.signal.aborted)return false;
    const projected=entries.map(asEndpointOption);
    deps.setManagedEndpoints(projected);
    rememberPersonalGraphServers(session.graphStore,session.username??"",projected);
    verifiedSeedRevisions.set(session,seed.revision);
    deps.setPersonalPoliciesReady(true);
  }catch(error){
    if(attempt.signal.aborted)return false;
    deps.setPersonalPoliciesSeedError(error instanceof Error?error.message:"Personal store initialization failed.");
    deps.setPersonalPoliciesReady(false);
    throw error;
  }
  return !attempt.signal.aborted;
}
export function useAuthenticationSessionLifecycle(deps:AuthenticationLifecycleDependencies,controller:PersonalInitializationController):void {
  useEffect(()=>{
    let mounted=true;
    controller.start();
    const synchronize=(kind:"changed"|"snapshot")=>{
      if(!mounted)return;
      const current=restoredDigestSession();
      if(kind==="snapshot" && current){
        void readSessionHydration(current).then(saved=>{
          if(!mounted || restoredDigestSession()!==current || !saved.snapshot || saved.snapshot.seedRevision!==verifiedSeedRevisions.get(current))return;
          const base=graphForPrefix(current.graphPrefix);
          hydrateAuthBootstrap(current,saved.snapshot.bindings,saved.snapshot.buttons);
          restoreSessionKinds(`${base}@${personalWriteEndpoint(current)}`,base,saved.snapshot.kinds);
          const projected=saved.snapshot.servers.map(asEndpointOption);
          deps.setManagedEndpoints(projected);
          rememberPersonalGraphServers(current.graphStore,current.username??"",projected);
          window.dispatchEvent(new Event(PERSONAL_SERVERS_CHANGED));
        }).catch(()=>{/* A concurrent Disconnect owns the session reset. */});
        return;
      }
      // A changed notification comes from another tab, not Retry. Only a
      // genuine session change may withdraw the old Digest carrier here.
      const scope=current ? `${current.graphStore}|${current.graphPrefix}|${current.username??""}` : "restore";
      void controller.run(`changed|${scope}`,async attempt=>{
        disconnectDigestSession();resetMaestroKinds();
        if(attempt.signal.aborted)return false;
        deps.setAuthSession(null);
        deps.setPersonalPoliciesReady(false);deps.setPersonalPoliciesSeedError("");
        deps.setManagedEndpoints([]);deps.setPersonalSparqlEndpoint("");
        const restored=await restoreUserSession(deps,attempt);
        if(restored && !attempt.signal.aborted)deps.setLoginDialogOpen(false);
        return restored;
      });
    };
    const unsubscribe=subscribeDigestSessionChanges(synchronize);
    void controller.run("restore",attempt=>restoreUserSession(deps,attempt));
    return()=>{
      mounted=false;unsubscribe();controller.stop();
      // Strict Mode remount is not logout. The Digest carrier must survive.
    };
  },[controller]);
}
