import type { MaestroQueryTab } from "./query-view-ownership";

/** A share URL is a selection even if its destination is not yet executable.
 * Return only the prerequisites of THAT destination. Discovery and seeding
 * remain independent controllers and must not be started by this selector. */
export type RestoredViewReadinessInput = Readonly<{
  tab: MaestroQueryTab;
  hydrated: boolean;
  queryReady: boolean;
  personalReady: boolean;
  personalSessionPresent: boolean;
  personalPolicyStage: "unavailable" | "seeding" | "verifying" | "ready" | "failed";
  selectedAnalysisUri: string;
  analysisBuiltIn: boolean;
  analysisEligible: boolean;
}>;
export type RestoredViewReadiness = Readonly<{ ready: boolean; reason: string; blockedOn: "url" | "graph" | "personal" | "provider" | null; skeleton: boolean }>;
export function restoredViewReadiness(input: RestoredViewReadinessInput): RestoredViewReadiness {
  if (!input.hydrated) return { ready: false, blockedOn: "url", skeleton: true, reason: "Restoring the shared query and selected tab…" };
  if (!input.queryReady) return { ready: false, blockedOn: "graph", skeleton: true, reason: "Waiting for the selected graph server and query…" };
  const personalWait = (): RestoredViewReadiness => {
    if (!input.personalSessionPresent)
      return { ready: false, blockedOn: "personal", skeleton: false, reason: "Connect to activate this saved view. The shared selection is preserved." };
    if (input.personalPolicyStage === "failed")
      return { ready: false, blockedOn: "personal", skeleton: false, reason: "Personal initialization did not finish. Reconnect or retry initialization to activate this view." };
    return { ready: false, blockedOn: "personal", skeleton: true, reason: "Waiting for personal graph policies and provider readiness…" };
  };
  if (input.tab === "view" && !input.personalReady) return personalWait();
  if (input.tab === "analyze" && input.selectedAnalysisUri && !input.analysisBuiltIn) {
    if (!input.personalReady) return personalWait();
    if (!input.analysisEligible)
      return { ready: false, blockedOn: "provider", skeleton: true, reason: "Checking provider eligibility and approval for this Analysis…" };
  }
  return { ready: true, blockedOn: null, skeleton: false, reason: "" };
}
