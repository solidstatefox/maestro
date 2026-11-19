import { FOCUS_LAYERS } from "../renderer-dom";
// Visibility rules for the renderer-owned tooltip and focus layers (gap #20; no documented hook, gap #36).
const GATED_LAYERS = `.ts-chart-tooltip,${FOCUS_LAYERS}`;

/** Until the chart's data is on screen (`data-bkm-interactive`, raised by the ready gate as the reveal starts; entrance/ready-gate.ts) the host
 * takes no pointer and the tooltip and focus layers are hidden; `deep` also hides their descendants. The entrance itself doesn't hold
 * the pointer: bklit's `canInteract` waits for `isLoaded`, this lets the chart be hovered while it draws in. */
export const interactiveGateCss = (scope: string, deep = false): string => {
  const gated = `${scope}:not([data-bkm-interactive]) :is(${GATED_LAYERS})`;
  const inert = `${scope}:not([data-bkm-interactive]) .ts-chart-host{pointer-events:none}`;
  const hidden = deep ? `${gated},${gated} *{visibility:hidden}` : `${gated}{visibility:hidden}`;
  return inert + hidden;
};

/** Pointer inside the chart with no focused row (`guard` fails): the layers stay hidden until a row resolves. */
export const focusEmptyHiddenCss = (scope: string, guard = ":not([data-bkm-on])", layers = GATED_LAYERS): string =>
  `${scope}${guard} .ts-chart-surface:hover :is(${layers}){visibility:hidden}`;
