"use client";

import { useEffect, useRef, useState } from "react";
import { MAESTRO_LANGUAGE_CHANGED, readUrlLanguage, changeUrlLanguage, setSheetLanguage, validMaestroLanguage } from "@/lib/maestro-language";
import { createLanguageOverrideActor } from "@/lib/app-lifecycle/language-override";
import type { ShareableUiState } from "@/canvas/utils/query-controller";

/** Share URL toolbar states; the canonical keys win over legacy aliases. */
export function readToolbarToggleState(restored: ShareableUiState | null | undefined) {
  return {
    queryTreeOpen: typeof restored?.queryToggle === "boolean"
      ? restored.queryToggle : restored?.centralTab === "query-tree",
    showResultBadges: typeof restored?.showResultBadges === "boolean"
      ? restored.showResultBadges : restored?.badgesToggle === true,
  };
}

/** State owned by the preferences subsystem. Query-tree mutations still use the authoritative FCT store. */
export function usePreferencesState() {
  const [controlsSheetOpen, setControlsSheetOpen] = useState(false);
  const [clearCacheDialogOpen, setClearCacheDialogOpen] = useState(false);
  const [savedSheetLanguage, setSavedSheetLanguage] = useState("en");
  const [languageOverride, setLanguageOverride] = useState<string | null>(null);
  const languageActor = useRef<ReturnType<typeof createLanguageOverrideActor> | null>(null);
  useEffect(() => {
    const actor = createLanguageOverrideActor();
    languageActor.current = actor;
    const update = () => {
      const language = readUrlLanguage();
      actor.send({ type: "RESTORE", language });
      setLanguageOverride(language);
    };
    update();
    window.addEventListener("popstate", update);
    window.addEventListener(MAESTRO_LANGUAGE_CHANGED, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(MAESTRO_LANGUAGE_CHANGED, update);
      actor.stop();
      languageActor.current = null;
    };
  }, []);
  const preferredAlphabetLanguage = languageOverride ?? savedSheetLanguage;
  const restoreSheetLanguage = (value: string) => {
    const next = validMaestroLanguage(value);
    if (!next) return;
    setSavedSheetLanguage(next);
    setSheetLanguage(next);
  };
  const setPreferredAlphabetLanguage = (value: string) => {
    const next = validMaestroLanguage(value);
    if (!next) return;
    if (readUrlLanguage() !== null) {
      languageActor.current?.send({ type: "SET", language: next });
      changeUrlLanguage(next);
    } else restoreSheetLanguage(next);
  };
  const addLanguageToShareUrl = () => {
    languageActor.current?.send({ type: "SET", language: preferredAlphabetLanguage });
    changeUrlLanguage(preferredAlphabetLanguage);
  };
  const removeLanguageFromShareUrl = () => {
    languageActor.current?.send({ type: "REMOVE" });
    changeUrlLanguage(null);
  };
  const [prefixSource, setPrefixSource] = useState<"prefixcc" | "zazuko" | "builtin">("prefixcc");
  const [prefixStatus, setPrefixStatus] = useState("Built-in prefixes");
  const [centralTab, setCentralTab] = useState<"results" | "groups" | "query-tree" | "view-query" | "chat">("results");
  const [workspaceTab, setWorkspaceTab] = useState<"browse" | "view" | "analyze">("browse");
  const [queryTreeOpen, setQueryTreeOpen] = useState(false);
  const [queryTreeHeightPercent, setQueryTreeHeightPercent] = useState(40);
  const [queryTreeHeightLoaded, setQueryTreeHeightLoaded] = useState(false);
  const [recordFormatEnabled, setRecordFormatEnabled] = useState(false);
  const [recordFormatPreferenceLoaded, setRecordFormatPreferenceLoaded] = useState(false);
  const queryTreeHeightDbRef = useRef<IDBDatabase | null>(null);
  const [showResultBadges, setShowResultBadges] = useState(false);
  const [orderResults, setOrderResults] = useState(false);
  const [breadcrumbBadgeMode, setBreadcrumbBadgeMode] = useState<"records" | "classes">("records");
  const [hoveredBreadcrumbBadgeId, setHoveredBreadcrumbBadgeId] = useState<string | null>(null);
  const [openBreadcrumbDropdownId, setOpenBreadcrumbDropdownId] = useState<string | null>(null);
  const [shiftKeyDown, setShiftKeyDown] = useState(false);
  const [hoveredFacetKey, setHoveredFacetKey] = useState<string | null>(null);
  const [panelLimitsOpen, setPanelLimitsOpen] = useState(false);
  const [timeoutEditorOpen, setTimeoutEditorOpen] = useState(false);

  return {
    controlsSheetOpen,
    setControlsSheetOpen,
    clearCacheDialogOpen,
    setClearCacheDialogOpen,
    preferredAlphabetLanguage,
    setPreferredAlphabetLanguage,
    restoreSheetLanguage,
    languageOverride,
    addLanguageToShareUrl,
    removeLanguageFromShareUrl,
    prefixSource,
    setPrefixSource,
    prefixStatus,
    setPrefixStatus,
    centralTab,
    setCentralTab,
    workspaceTab,
    setWorkspaceTab,
    queryTreeOpen,
    setQueryTreeOpen,
    queryTreeHeightPercent,
    setQueryTreeHeightPercent,
    queryTreeHeightLoaded,
    setQueryTreeHeightLoaded,
    recordFormatEnabled,
    setRecordFormatEnabled,
    recordFormatPreferenceLoaded,
    setRecordFormatPreferenceLoaded,
    queryTreeHeightDbRef,
    showResultBadges,
    setShowResultBadges,
    orderResults,
    setOrderResults,
    breadcrumbBadgeMode,
    setBreadcrumbBadgeMode,
    hoveredBreadcrumbBadgeId,
    setHoveredBreadcrumbBadgeId,
    openBreadcrumbDropdownId,
    setOpenBreadcrumbDropdownId,
    shiftKeyDown,
    setShiftKeyDown,
    hoveredFacetKey,
    setHoveredFacetKey,
    panelLimitsOpen,
    setPanelLimitsOpen,
    timeoutEditorOpen,
    setTimeoutEditorOpen,
  };
}
