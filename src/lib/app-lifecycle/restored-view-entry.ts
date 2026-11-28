import type { MaestroQueryTab } from "./query-view-ownership";
import type { ShareableUiState } from "../../canvas/utils/query-controller";

/** A one-shot admission check for an arriving share URL. Never use this for
 * normal tab navigation or as a second, competing provider-discovery actor. */
export type RestoredViewEntryInput = Readonly<{
  tab: MaestroQueryTab;
  authRestored: boolean;
  accessRestoring: boolean;
  personalSessionPresent: boolean;
  personalReady: boolean;
  personalPolicyStage: "unavailable" | "seeding" | "verifying" | "ready" | "failed";
  queryReady: boolean;
  cancelled: boolean;
  selectedAnalysisUri: string;
  analysisBuiltIn: boolean;
  analysisEligible: boolean;
}>;
export type RestoredViewEntryDecision = Readonly<
  { status: "admit"; reason: "" } | { status: "browse"; reason: string }
>;

export function decideRestoredViewEntry(input: RestoredViewEntryInput): RestoredViewEntryDecision {
  if (input.tab === "browse") return { status: "admit", reason: "" };
  const personal = input.tab === "view" || (input.tab === "analyze" &&
    Boolean(input.selectedAnalysisUri) && !input.analysisBuiltIn);
  if (input.cancelled)
    return { status: "browse", reason: "Execution is cancelled. Try reopening the original saved URL once you have resumed query execution." };
  if (personal && (!input.authRestored || input.accessRestoring))
    return { status: "browse", reason: "Personal login restoration is pending. Try reopening the original saved URL once login restoration and personal initialization are complete." };
  if (personal && !input.personalSessionPresent)
    return { status: "browse", reason: "This saved destination requires a personal login, but no authenticated session was restored. Try reopening the original saved URL once you have connected and personal initialization is complete." };
  if (personal && !input.personalReady) {
    if (input.personalPolicyStage === "failed")
      return { status: "browse", reason: "Personal initialization failed. Try reopening the original saved URL once initialization succeeds." };
    return { status: "browse", reason: "Personal policies and provider readiness are still initializing. Try reopening the original saved URL once personal initialization is complete." };
  }
  if (!input.queryReady)
    return { status: "browse", reason: "The graph server and query are not ready. Try reopening the original saved URL once query execution is ready." };
  if (input.tab === "analyze" && input.selectedAnalysisUri &&
      !input.analysisBuiltIn && !input.analysisEligible)
    return { status: "browse", reason: "The selected Analysis does not yet have applicable, approved provider evidence for this query. Try reopening the original saved URL once provider eligibility has been established." };
  return { status: "admit", reason: "" };
}

/** A denied destination is discarded, not saved for retry. Preserve all FCT and
 * ordinary Browse UI parameters while clearing only the rejected ribbon state. */
export function browseFallbackUiState(restored: ShareableUiState | null): ShareableUiState {
  return { ...restored, workspaceTab: "browse", viewPanel: "trail", viewProvider: null,
    selectedViewUri: "", selectedAnalysisUri: "", analyzeHistogram: false,
    centralTab: "results", querySourceFormat: "xml" };
}
