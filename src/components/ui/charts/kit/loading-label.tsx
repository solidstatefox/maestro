import type { CSSProperties, ReactElement } from "react";

// Shared loading label overlay for line, area and heatmap placeholders (also bklit `ChartLoadingLabel`).
// bklit line-loading-timing.ts: LOADING_LABEL_EXIT_S 0.45s on LINE_LOADING_PULSE_EASE.
const LABEL_TRANSITION = "transform 0.45s cubic-bezier(0.85, 0, 0.15, 1), opacity 0.45s cubic-bezier(0.85, 0, 0.15, 1), filter 0.45s cubic-bezier(0.85, 0, 0.15, 1)";
const SHOWN_STYLE: CSSProperties = { transition: LABEL_TRANSITION };
const EXITING_STYLE: CSSProperties = { transition: LABEL_TRANSITION, transform: "translateY(30px)", opacity: 0, filter: "blur(2px)" };
/** bklit shimmering-text.tsx: one char pulse lasts `duration` (default 1s), then waits `text.length * 0.05`s before it repeats. */
const CHAR_PULSE_S = 1;
const CHAR_REPEAT_DELAY_S = 0.05;

/** bklit shimmering-text.tsx:42-56 colour keyframes [--bkm-label-color, --bkm-shimmer-color, --bkm-label-color] (easeInOut each leg, then the repeat delay) as CSS for a label of `length` chars. */
const charKeyframes = (length: number): string => {
  const cycle = CHAR_PULSE_S + length * CHAR_REPEAT_DELAY_S;
  const end = (CHAR_PULSE_S / cycle) * 100;
  return `@keyframes bkm-label-char-${length}{0%{color:var(--bkm-label-color);animation-timing-function:ease-in-out}${end / 2}%{color:var(--bkm-shimmer-color);animation-timing-function:ease-in-out}${end}%,100%{color:var(--bkm-label-color)}}`;
};

const SR_ONLY: CSSProperties = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap", border: 0 };

const charStyle = (index: number, length: number): CSSProperties => ({
  animation: `bkm-label-char-${length} ${CHAR_PULSE_S + length * CHAR_REPEAT_DELAY_S}s infinite`,
  animationDelay: `${(index * CHAR_PULSE_S) / length}s`,
});

const LoadingLabel = ({ text, className, exiting = false }: Readonly<{ text: string; className?: string; exiting?: boolean }>): ReactElement | null => {
  if (!text.trim()) {return null;}
  const chars = text.split("");
  return (
    <output
      className={className === undefined ? "ts-bkm-loading-label-wrap" : `ts-bkm-loading-label-wrap ${className}`}
      data-slot="loading-label"
      aria-live="polite"
      style={exiting ? EXITING_STYLE : SHOWN_STYLE}
    >
      <style>{charKeyframes(text.length)}</style>
      <span className="ts-bkm-loading-label-text">
        {chars.map((char, index) => (
          // eslint-disable-next-line react/no-array-index-key -- static label text, order never changes (bklit shimmering-text.tsx:80)
          <span key={index} aria-hidden="true" className="ts-bkm-loading-label-char" style={charStyle(index, text.length)}>{char}</span>
        ))}
        <span style={SR_ONLY}>{text}</span>
      </span>
    </output>
  );
}

export { LoadingLabel };
