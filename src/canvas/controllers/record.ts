"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createMaestroRecordSessionController } from "@/lib/app-lifecycle/record-session";

/** One XState lifecycle per Record viewer, including Browse session zero.
 * The existing Record FCT snapshot and policy data are not copied into XState. */
export function useRecordState() {
  const [recordLifecycle] = useState(createMaestroRecordSessionController);
  const recordSnapshot = useSyncExternalStore(recordLifecycle.subscribe, recordLifecycle.getSnapshot, recordLifecycle.getSnapshot);
  useLayoutEffect(() => {
    recordLifecycle.start();
    return () => recordLifecycle.stop();
  }, [recordLifecycle]);
  const send = (operation: "description" | "policy", loading: boolean) => {
    const key = recordLifecycle.getSnapshot().context.key;
    recordLifecycle.operation(operation, loading ? "OP_STARTED" : "OP_SUCCEEDED", key);
  };
  const error = (operation: "description" | "policy", value: string) => {
    const key = recordLifecycle.getSnapshot().context.key;
    if (value) recordLifecycle.send({ type: "OP_FAILED", operation, key, error: value });
    else recordLifecycle.send({ type: "ERROR_CLEARED", operation, key });
  };
  const [recordPolicyCheckedUri, setRecordPolicyCheckedUri] = useState("");
  const [recordDescribeIncomplete, setRecordDescribeIncomplete] = useState(false);
  const activeFormatterRequestRef = useRef("");
  const [formattedRecordKey, setFormattedRecordKey] = useState("");
  const [formatterHasEnrichment, setFormatterHasEnrichment] = useState(false);
  const attemptedFormatterEnrichmentRef = useRef("");
  return {
    recordLifecycle,
    isLoadingRecordPolicy: recordSnapshot.context.phases.policy === "loading",
    setIsLoadingRecordPolicy: (value: boolean) => send("policy", value),
    recordPolicyCheckedUri, setRecordPolicyCheckedUri,
    recordPolicyError: recordSnapshot.context.errors.policy,
    setRecordPolicyError: (value: string) => error("policy", value),
    isDescribing: recordSnapshot.context.phases.description === "loading",
    isFormattingRecord: recordSnapshot.context.phases.format === "loading",
    setIsDescribing: (value: boolean) => send("description", value),
    recordDescriptionError: recordSnapshot.context.errors.description,
    setRecordDescriptionError: (value: string) => error("description", value),
    recordDescribeIncomplete, setRecordDescribeIncomplete,
    activeFormatterRequestRef,
    formattedRecordKey, setFormattedRecordKey,
    formatterHasEnrichment, setFormatterHasEnrichment,
    attemptedFormatterEnrichmentRef,
  };
}
