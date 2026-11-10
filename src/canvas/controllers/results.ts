"use client";

import { useRef, useState } from "react";
import type { FctResult } from "@/canvas/utils/fct-response";
import type { GroupMembersState } from "@/canvas/left/filter";

/** State owned by the results subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useResultsState() {
  const [groupByPropertyUri, setGroupByPropertyUri] = useState("");
  const groupByBeforeCodeViewRef = useRef("");
  const [resultsUiPage, setResultsUiPage] = useState(0);
  const [groupUiPage, setGroupUiPage] = useState(0);
  const [groupBatchSize, setGroupBatchSize] = useState<number>(100);
  const [groupBatchOffset, setGroupBatchOffset] = useState(0);
  const [groupHasMoreBatches, setGroupHasMoreBatches] = useState(false);
  const groupCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pendingGroupScrollRef = useRef<string | null>(null);
  const [groupValues, setGroupValues] = useState<FctResult[]>([]);
  const [groupValuesLoading, setGroupValuesLoading] = useState(false);
  const [groupValuesError, setGroupValuesError] = useState("");
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMembersState>>({});
  const [alphabetCounts, setAlphabetCounts] = useState<Record<string, number>>({});
  const alphabetCountsQueryRef = useRef("");
  const [alphabetError, setAlphabetError] = useState("");
  const [isLoadingAlphabet, setIsLoadingAlphabet] = useState(false);
  const [alphabetPreflight, setAlphabetPreflight] = useState<"checking" | "available" | "unavailable">("checking");
  const [results, setResults] = useState<FctResult[]>([]);
  const resultsBatchRequestPending = useRef(false);
  const resultsLoadedQueryIdentityRef = useRef("");
  const activeQueryIdentityRef = useRef("");
  const previousResultsQueryIdentityRef = useRef("");
  const lastPreflightRef = useRef("");
  const preflightInFlightRef = useRef("");
  const [resultsTotalCount, setResultsTotalCount] = useState<number | null>(null);
  const [resultsPageMatchCount, setResultsPageMatchCount] = useState(0);
  const [resultsPageComplete, setResultsPageComplete] = useState(false);
  const [isCountingResults, setIsCountingResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [resultsRawResponse, setResultsRawResponse] = useState("# No Results FCT response received yet.");
  const [resultListValuesDebug, setResultListValuesDebug] = useState<{ xml: string; sparql: string } | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searchPipelineRun, setSearchPipelineRun] = useState(0);
  const [initialBrowseTriggered, setInitialBrowseTriggered] = useState(false);

  return {
    groupByPropertyUri,
    setGroupByPropertyUri,
    groupByBeforeCodeViewRef,
    resultsUiPage,
    setResultsUiPage,
    groupUiPage,
    setGroupUiPage,
    groupBatchSize,
    setGroupBatchSize,
    groupBatchOffset,
    setGroupBatchOffset,
    groupHasMoreBatches,
    setGroupHasMoreBatches,
    groupCardRefs,
    pendingGroupScrollRef,
    groupValues,
    setGroupValues,
    groupValuesLoading,
    setGroupValuesLoading,
    groupValuesError,
    setGroupValuesError,
    groupMembers,
    setGroupMembers,
    alphabetCounts,
    setAlphabetCounts,
    alphabetCountsQueryRef,
    alphabetError,
    setAlphabetError,
    isLoadingAlphabet,
    setIsLoadingAlphabet,
    alphabetPreflight,
    setAlphabetPreflight,
    results,
    setResults,
    resultsBatchRequestPending,
    resultsLoadedQueryIdentityRef,
    activeQueryIdentityRef,
    previousResultsQueryIdentityRef,
    lastPreflightRef,
    preflightInFlightRef,
    resultsTotalCount,
    setResultsTotalCount,
    resultsPageMatchCount,
    setResultsPageMatchCount,
    resultsPageComplete,
    setResultsPageComplete,
    isCountingResults,
    setIsCountingResults,
    isSearching,
    setIsSearching,
    resultsRawResponse,
    setResultsRawResponse,
    resultListValuesDebug,
    setResultListValuesDebug,
    searchError,
    setSearchError,
    searchPipelineRun,
    setSearchPipelineRun,
    initialBrowseTriggered,
    setInitialBrowseTriggered,
  };
}
