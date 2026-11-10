"use client";

import { useState, useEffect } from "react";
import { initializeMaestroStorage, maestroStorageGet, maestroStorageSet } from "@/lib/maestro-storage";
import { configureMaestroBrowserLogging, type BrowserLogLevel } from "@/lib/maestro-client-logging";



/** Estimates localStorage key/value payload size; browsers do not expose exact quota usage. */
export function getLocalStorageUsageBytes(): number {
  let bytes = 0;
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key === null) continue;
    const value = window.localStorage.getItem(key) ?? "";
    // localStorage strings are commonly accounted for as UTF-16 code units.
    bytes += (key.length + value.length) * 2;
  }
  return bytes;
}

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}


/** Owns the persisted browser logging preference and its startup restoration. */
export function useBrowserLoggingSettings() {
  const [browserLogging, setBrowserLogging] = useState(false);
  const [browserLogLevel, setBrowserLogLevel] = useState<BrowserLogLevel>("debug");
  const [browserLogPreferencesLoaded, setBrowserLogPreferencesLoaded] = useState(false);
  useEffect(() => {
    void initializeMaestroStorage().then(() => {
      setBrowserLogging(maestroStorageGet("maestro-browser-logging") === "yes");
      const configured = maestroStorageGet("maestro-browser-log-level");
      if (["trace", "debug", "info", "warn", "error", "fatal"].includes(configured ?? ""))
        setBrowserLogLevel(configured as BrowserLogLevel);
      setBrowserLogPreferencesLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!browserLogPreferencesLoaded) return;
    configureMaestroBrowserLogging(browserLogging, browserLogLevel);
    maestroStorageSet("maestro-browser-logging", browserLogging ? "yes" : "no");
    maestroStorageSet("maestro-browser-log-level", browserLogLevel);
  }, [browserLogging, browserLogLevel, browserLogPreferencesLoaded]);
  return { browserLogging, setBrowserLogging, browserLogLevel, setBrowserLogLevel };
}

/** Only observe storage usage while the Settings sheet is open. */
export function useLocalStorageUsage(controlsSheetOpen: boolean) {
  const [localStorageUsageBytes, setLocalStorageUsageBytes] = useState<number | null>(null);

  useEffect(() => {
    if (!controlsSheetOpen) return;
    const refreshUsage = () => {
      try {
        setLocalStorageUsageBytes(getLocalStorageUsageBytes());
      } catch {
        setLocalStorageUsageBytes(null);
      }
    };
    refreshUsage();
    window.addEventListener("storage", refreshUsage);
    return () => window.removeEventListener("storage", refreshUsage);
  }, [controlsSheetOpen]);
  return { localStorageUsageBytes, setLocalStorageUsageBytes };
}

// Shared panel limit and page sizing preferences.
export const DEFAULT_RESULTS_PAGE_SIZE = 20;
export const RESULTS_PAGE_SIZE_STORAGE_KEY = "maestro-results-page-size";
export const RESULTS_BATCH_SIZE_OPTIONS = [100, 200, 300, 400, 500, 1000, 2000] as const;
/** LIMIT applied to every left-panel widget: Categories, Personal facets, Graphs, and Configure Properties/Roles. */
export const LEFT_PANEL_LIMIT_STORAGE_KEY = "maestro-left-panel-limit";
export const DEFAULT_LEFT_PANEL_LIMIT = 30;
export const CENTER_PANEL_LIMIT_STORAGE_KEY = "maestro-center-panel-limit";
export const CENTER_GROUP_LIMIT_STORAGE_KEY = "maestro-center-group-limit";
export const RIGHT_PANEL_DESCRIBE_LIMIT_STORAGE_KEY = "maestro-right-panel-describe-limit";
export const RIGHT_PANEL_PAGE_LIMIT_STORAGE_KEY = "maestro-right-panel-page-limit";
export const RIGHT_PANEL_DESCRIBE_LIMIT_OPTIONS = [30, 100, 250, 500, 1000, 10000] as const;
export const RIGHT_PANEL_PAGE_LIMIT_OPTIONS = [10, 20, 30, 50, 100] as const;
