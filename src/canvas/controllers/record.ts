"use client";

import { useRef, useState } from "react";

/** State owned by the record subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useRecordState() {
  const [isLoadingRecordPolicy, setIsLoadingRecordPolicy] = useState(false);
  const [recordPolicyCheckedUri, setRecordPolicyCheckedUri] = useState("");
  const [recordPolicyError, setRecordPolicyError] = useState("");
  const [isDescribing, setIsDescribing] = useState(false);
  const [recordDescriptionError, setRecordDescriptionError] = useState("");
  const [recordDescribeIncomplete, setRecordDescribeIncomplete] = useState(false);
  const activeFormatterRequestRef = useRef("");
  const [formattedRecordKey, setFormattedRecordKey] = useState("");
  const [formatterHasEnrichment, setFormatterHasEnrichment] = useState(false);
  const attemptedFormatterEnrichmentRef = useRef("");

  return {
    isLoadingRecordPolicy,
    setIsLoadingRecordPolicy,
    recordPolicyCheckedUri,
    setRecordPolicyCheckedUri,
    recordPolicyError,
    setRecordPolicyError,
    isDescribing,
    setIsDescribing,
    recordDescriptionError,
    setRecordDescriptionError,
    recordDescribeIncomplete,
    setRecordDescribeIncomplete,
    activeFormatterRequestRef,
    formattedRecordKey,
    setFormattedRecordKey,
    formatterHasEnrichment,
    setFormatterHasEnrichment,
    attemptedFormatterEnrichmentRef,
  };
}
