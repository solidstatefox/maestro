import { px } from "../style";
import type { StyleObject } from "../style";
import { el } from "./node";
import type { MarkupNode } from "./node";

// bklit line-loading-timing.ts: LOADING_LABEL_EXIT_S 0.45s on LINE_LOADING_PULSE_EASE.
const LABEL_TRANSITION = "transform 0.45s cubic-bezier(0.85, 0, 0.15, 1), opacity 0.45s cubic-bezier(0.85, 0, 0.15, 1), filter 0.45s cubic-bezier(0.85, 0, 0.15, 1)";
const SHOWN_STYLE: StyleObject = { transition: LABEL_TRANSITION };
const EXITING_STYLE: StyleObject = { transition: LABEL_TRANSITION, transform: "translateY(30px)", opacity: 0, filter: "blur(2px)" };
/** bklit shimmering-text.tsx: one char pulse lasts `duration` (default 1s), then waits `text.length * 0.05`s before it repeats. */
const CHAR_PULSE_S = 1;
const CHAR_REPEAT_DELAY_S = 0.05;

/** bklit shimmering-text.tsx:42-56 colour keyframes [--bkm-label-color, --bkm-shimmer-color, --bkm-label-color] (easeInOut each leg, then the repeat delay) as CSS for a label of `length` chars. */
const charKeyframes = (length: number): string => {
  const cycle = CHAR_PULSE_S + length * CHAR_REPEAT_DELAY_S;
  const end = (CHAR_PULSE_S / cycle) * 100;
  return `@keyframes bkm-label-char-${length}{0%{color:var(--bkm-label-color);animation-timing-function:ease-in-out}${end / 2}%{color:var(--bkm-shimmer-color);animation-timing-function:ease-in-out}${end}%,100%{color:var(--bkm-label-color)}}`;
};

const SR_ONLY: StyleObject = { position: "absolute", width: /* @__PURE__ */ px(1), height: /* @__PURE__ */ px(1), margin: /* @__PURE__ */ px(-1), padding: 0, overflow: "hidden", "clip-path": "inset(50%)", "white-space": "nowrap", border: 0 };

const charStyle = (index: number, length: number): StyleObject => ({
  animation: `bkm-label-char-${length} ${CHAR_PULSE_S + length * CHAR_REPEAT_DELAY_S}s infinite`,
  "animation-delay": `${(index * CHAR_PULSE_S) / length}s`,
});

const WRAP_CLASS = "ts-bkm-loading-label-wrap";

/** What the label shows: its text, the reader's class after the kit's, and whether it's leaving. */
interface LoadingLabelInput {
  readonly text: string;
  readonly className?: string;
  readonly exiting?: boolean;
}

/** The label for `text`, `null` for blank text. */
export const loadingLabelTree = ({ text, className, exiting = false }: Readonly<LoadingLabelInput>): MarkupNode | null => {
  if (!text.trim()) {
    return null;
  }
  return el(
    "output",
    { class: className === undefined ? WRAP_CLASS : `${WRAP_CLASS} ${className}`, "data-slot": "loading-label", "aria-live": "polite" },
    [
      el("style", {}, [charKeyframes(text.length)]),
      el("span", { class: "ts-bkm-loading-label-text" }, [
        // Static label text, order never changes (bklit shimmering-text.tsx:80): the index is the key.
        ...text.split("").map((char, index) => el("span", { "aria-hidden": "true", class: "ts-bkm-loading-label-char" }, [char], { key: index, style: charStyle(index, text.length) })),
        el("span", {}, [text], { style: SR_ONLY }),
      ]),
    ],
    { style: exiting ? EXITING_STYLE : SHOWN_STYLE },
  );
};
