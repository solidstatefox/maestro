"use client";

import { useRef, useState } from "react";

/** State owned by the history subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useHistoryState() {
  const [deleteHistoryDialogOpen, setDeleteHistoryDialogOpen] = useState(false);
  const [isDeletingHistory, setIsDeletingHistory] = useState(false);
  const [isLoadingHistoryQuery, setIsLoadingHistoryQuery] = useState(false);
  const [historyHasOlder, setHistoryHasOlder] = useState(false);
  const [historyHasNewer, setHistoryHasNewer] = useState(false);
  const [historyNavigationPending, setHistoryNavigationPending] = useState<"backward" | "forward" | null>(null);
  const [historyActionItems, setHistoryActionItems] = useState<Array<{ historyId: string; created: string; action: { operator: "+" | "-"; xpath: string; value?: string } | null }>>([]);
  const [historyActionMenu, setHistoryActionMenu] = useState<"backward" | "forward" | null>(null);
  const historyHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDeletingCurrentHistory, setIsDeletingCurrentHistory] = useState(false);
  const historyVisitQueryRef = useRef("");
  const historyVisitIdRef = useRef("");
  const historyWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const templateHistoryFlushRef = useRef(false);
  const pendingHistoryVisitRef = useRef<{ queryXml: string; stateUrl: string; action: { operator: "+" | "-"; xpath: string; value?: string } | null } | null>(null);

  return {
    deleteHistoryDialogOpen,
    setDeleteHistoryDialogOpen,
    isDeletingHistory,
    setIsDeletingHistory,
    isLoadingHistoryQuery,
    setIsLoadingHistoryQuery,
    historyHasOlder,
    setHistoryHasOlder,
    historyHasNewer,
    setHistoryHasNewer,
    historyNavigationPending,
    setHistoryNavigationPending,
    historyActionItems,
    setHistoryActionItems,
    historyActionMenu,
    setHistoryActionMenu,
    historyHoverTimerRef,
    isDeletingCurrentHistory,
    setIsDeletingCurrentHistory,
    historyVisitQueryRef,
    historyVisitIdRef,
    historyWriteQueueRef,
    templateHistoryFlushRef,
    pendingHistoryVisitRef,
  };
}
