"use client";

import type { ReactElement } from "react";
import { CHART_ROLE } from "./children";
import { CARRIER_ENABLE } from "./core/carriers/roles";
import { enableOverlays } from "./core/cartesian/enable-overlays";
import type { ReferenceAreaProps } from "./core/types/reference-area";

// Config-carrier marker declared on the component type (children.tsx
// ChartChildComponent pattern), so attaching the role needs no assertion.
interface ReferenceAreaCarrier {
  (props: Readonly<ReferenceAreaProps>): ReactElement | null;
  [CHART_ROLE]?: string;
  [CARRIER_ENABLE]?: () => void;
  displayName: string;
}

/**
 * Shades a rectangular band of the plot between data bounds, with optional dashed edge lines and center markers. Place it as a child of a cartesian chart.
 */
const ReferenceArea: ReferenceAreaCarrier = /* @__PURE__ */ ((): ReferenceAreaCarrier => Object.assign(
  (_props: Readonly<ReferenceAreaProps>): ReactElement | null => null,
  // The chart hands the core the overlay builders as it reads this child (react/kit/read-children.ts).
  { [CHART_ROLE]: "referenceArea", [CARRIER_ENABLE]: enableOverlays, displayName: "ReferenceArea" },
))();

export { ReferenceArea };
