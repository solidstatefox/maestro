import type { StyleObject } from "../style";

/** Base UI's progress status: `value` between `min` and `max`, at `max`, or not a finite number. */
export type ProgressStatus = "progressing" | "complete" | "indeterminate";

/** What a progress bar's elements carry for its `value` and `max`. */
export interface ProgressParts {
  readonly status: ProgressStatus;
  /** The state attribute every part carries (Base UI's `data-progressing`, `data-complete` or `data-indeterminate`), written empty. */
  readonly stateAttr: `data-${ProgressStatus}`;
  /** The root's ARIA, in Base UI's order (after `aria-labelledby`); `aria-valuenow` left out while indeterminate. */
  readonly aria: {
    readonly "aria-valuemax": number;
    readonly "aria-valuemin": number;
    readonly "aria-valuenow": number | undefined;
    readonly "aria-valuetext": string;
    readonly role: "progressbar";
  };
  /** The indicator's fill, before the reader's style (none while indeterminate). */
  readonly indicatorStyle: StyleObject;
}

/** The span Base UI's root ends with (`visuallyHidden`, @base-ui/utils/visuallyHidden.mjs), as React writes its style. */
export const PROGRESS_HIDDEN_STYLE: StyleObject = {
  "clip-path": "inset(50%)",
  overflow: "hidden",
  "white-space": "nowrap",
  border: 0,
  padding: 0,
  width: "1px",
  height: "1px",
  margin: 0,
  position: "fixed",
  top: 0,
  left: 0,
};

/** The hidden span's text. */
export const PROGRESS_HIDDEN_TEXT = "x";

const MIN = 0;
const DEFAULT_MAX = 100;
const PERCENT = 100;

let percentFormat: Intl.NumberFormat | undefined;

// Base UI's `formatNumber(percentage / 100, undefined, { style: "percent" })`: the runtime's locale, made on first use.
const formatPercent = (fraction: number): string => {
  percentFormat ??= new Intl.NumberFormat(undefined, { style: "percent" });
  return percentFormat.format(fraction);
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

/** The parts of a progress bar at `value` of `max` (Base UI's defaults: `min` 0, `max` 100), with Base UI's arithmetic, NaN included. */
export const progressParts = (value: number | null | undefined, max: number = DEFAULT_MAX): ProgressParts => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return {
      status: "indeterminate",
      stateAttr: "data-indeterminate",
      aria: { "aria-valuemax": max, "aria-valuemin": MIN, "aria-valuenow": undefined, "aria-valuetext": "indeterminate progress", role: "progressbar" },
      indicatorStyle: {},
    };
  }
  const raw = ((value - MIN) * PERCENT) / (max - MIN);
  const percentage = clamp(Number.isNaN(raw) ? 0 : raw, 0, PERCENT);
  const clamped = clamp(value, MIN, max);
  const status: ProgressStatus = clamped === max ? "complete" : "progressing";
  return {
    status,
    stateAttr: `data-${status}`,
    aria: { "aria-valuemax": max, "aria-valuemin": MIN, "aria-valuenow": clamped, "aria-valuetext": formatPercent(percentage / PERCENT), role: "progressbar" },
    indicatorStyle: { "inset-inline-start": 0, height: "inherit", width: `${percentage}%` },
  };
};
