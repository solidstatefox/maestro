import type { MaestroQueryTab } from "./query-view-ownership";

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
  { status: "pending" | "admit"; reason: "" } | { status: "browse"; reason: string }
>;
export type RestoredViewFallback = Readonly<{ reason: string; originalUrl: string }>;

export function decideRestoredViewEntry(input: RestoredViewEntryInput): RestoredViewEntryDecision {
  if (input.tab === "browse") return { status: "admit", reason: "" };
  // Do not misclassify a restoring session as signed out.
  if (!input.authRestored || input.accessRestoring) return { status: "pending", reason: "" };
  const personal = input.tab === "view" || (input.tab === "analyze" &&
    Boolean(input.selectedAnalysisUri) && !input.analysisBuiltIn);
  if (personal && !input.personalSessionPresent)
    return { status: "browse", reason: "This saved View or Analysis requires a personal login, but no authenticated session was restored." };
  if (personal && !input.personalReady) {
    if (input.personalPolicyStage === "failed")
      return { status: "browse", reason: "You are signed in, but personal initialization failed. Reconnect or retry initialization before opening the saved URL." };
    return { status: "browse", reason: "You are signed in, but personal policies and provider readiness are still initializing." };
  }
  if (input.cancelled)
    return { status: "browse", reason: "Execution was cancelled; the saved View or Analysis is not currently active." };
  if (!input.queryReady)
    return { status: "browse", reason: "The graph server and query are not yet ready to activate this saved View or Analysis." };
  if (input.tab === "analyze" && input.selectedAnalysisUri &&
      !input.analysisBuiltIn && !input.analysisEligible)
    return { status: "browse", reason: "The saved Analysis is not yet eligible or approved for this query." };
  return { status: "admit", reason: "" };
}
