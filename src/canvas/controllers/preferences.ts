"use client";

import { useRef, useState } from "react";
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
  const [preferredAlphabetLanguage, setPreferredAlphabetLanguage] = useState("en");
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
