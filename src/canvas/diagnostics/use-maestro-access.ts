"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/ui/toast";
import type { PersonalAuthSession } from "@/lib/personal-auth";
import { createMaestroAccessController } from "@/lib/app-lifecycle/access";
import { lastProxyTransportObservation, PROXY_TRANSPORT_EVENT } from "@/lib/proxy-transport-observation";
import { lastPersonalHttpOutcome, PERSONAL_AUTH_OUTCOME } from "@/lib/personal-session-hint";
import type { PersonalInitializationController } from "@/lib/app-lifecycle/personal-initialization-machine";

/** The session resolver is the authentication authority. XState owns all UI
 * gates and bookmark verification; credentials never enter machine context. */
export function useMaestroAccess(session: PersonalAuthSession | null, restored: boolean, policiesReady: boolean, seedError: string, initialization: PersonalInitializationController) {
  const [controller] = useState(createMaestroAccessController);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const initializationSnapshot = useSyncExternalStore(initialization.subscribe, initialization.getSnapshot, initialization.getSnapshot);
  const lastNotifiedStageRef = useRef<{sessionKey:string;stage:string;error:string}>({sessionKey:"",stage:"",error:""});
  // An auth session with freshly rotated credentials is distinct even if its
  // public store URI/user name is unchanged. Do not store credentials in XState.
  const [sessionInstanceId] = useState(() => {
    const ids = new WeakMap<PersonalAuthSession, number>();
    let next = 0;
    return (value: PersonalAuthSession) => {
      let id = ids.get(value);
      if (!id) { id = ++next; ids.set(value, id); }
      return id;
    };
  });
  const sessionKey = restored && session?.graphStore && session?.graphPrefix && session?.authType === "sparql-auth"
    ? [session.graphStore, session.graphPrefix, session.authType, session.username ?? session.userName ?? "", String(sessionInstanceId(session))].join("|")
    : "";
  useLayoutEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  useEffect(() => {
    const observe = () => { const latest=lastProxyTransportObservation(); if(latest)controller.send({type:"PROXY_TRANSPORT_OBSERVED",state:latest.state}); };
    observe();window.addEventListener(PROXY_TRANSPORT_EVENT,observe);
    return ()=>window.removeEventListener(PROXY_TRANSPORT_EVENT,observe);
  },[controller]);
  useLayoutEffect(() => {
    controller.send({ type: "SESSION_OBSERVED", restored, sessionKey });
  }, [controller, restored, sessionKey]);
  useLayoutEffect(() => {
    if (!session || !sessionKey) return;
    let active = true;
    const sendSavedOutcome = () => {
      const saved = lastPersonalHttpOutcome(session);
      if (!saved) return false;
      controller.send({ type: "AUTH_STATUS_OBSERVED", sessionKey,
        state: saved.state, status: saved.status, at: saved.timestamp });
      return true;
    };
    // Only the current restored session's completed HTTP observations are published.
    sendSavedOutcome();
    const onResponse = () => { if (active) sendSavedOutcome(); };
    window.addEventListener(PERSONAL_AUTH_OUTCOME, onResponse);
    return () => { active = false; window.removeEventListener(PERSONAL_AUTH_OUTCOME, onResponse); };
  }, [controller, session, sessionKey]);
  // XState owns seeding, bootstrap AND state-machine verification. Access
  // observes its completed attempt, not an independently spawned React task.
  // The attempt id prevents a late result from an older retry unlocking gates.
  useEffect(() => {
    if (!sessionKey) return;
    const init=initializationSnapshot.context;
    const attemptId=init.request?.attemptId ?? 0;
    const stage=seedError || init.stage === "failed" ? "failed"
      : init.stage === "ready" && policiesReady ? "ready"
      : "seeding";
    controller.send({ type: "POLICY_STATUS_OBSERVED", sessionKey, attemptId, stage,
      error: stage === "failed" ? (seedError || init.error || "Personal initialization failed.") : "" });
  }, [controller, sessionKey, policiesReady, seedError,
    initializationSnapshot.context.request?.attemptId, initializationSnapshot.context.stage,
    initializationSnapshot.context.error]);
  // No seed-completion success toast: only a verified XState transition
  // is allowed to report final readiness. Distinct attempt/session scope
  // avoids duplicated Strict Mode notifications and misleading stale toasts.
  useEffect(() => {
    const stage = snapshot.context.policyStage;
    if (!sessionKey || snapshot.context.sessionKey !== sessionKey) return;
    const previous = lastNotifiedStageRef.current;
    const isTransition = previous.sessionKey !== sessionKey || previous.stage !== stage || previous.error !== snapshot.context.policyError;
    lastNotifiedStageRef.current = {sessionKey,stage,error:snapshot.context.policyError};
    if (stage === "ready" && isTransition) {
      toast.add({ title: "Personal graphs ready", description: "Personal graph reads and state machine verification completed.", type: "success" });
    }
    if (stage === "failed") {
      if (isTransition) {
        toast.add({title: "Personal initialization failed", description: snapshot.context.policyError || "state machine verification failed.", type: "error"});
      }
    }
  }, [sessionKey, snapshot.context.sessionKey, snapshot.context.policyStage, snapshot.context.policyError]);
  return { controller, snapshot, sessionKey };
}
