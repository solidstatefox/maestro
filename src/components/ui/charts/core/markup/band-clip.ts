import { el } from "./node";
import type { MarkupNode } from "./node";
import { HIDDEN_DEFS_STYLE } from "./resources";

/** A highlight's band: the rows either side of the focus it covers (`highlight.span`) and its soft ends (`highlight.fadeLength`, % per side). */
export interface HighlightBand {
  readonly span: number;
  readonly fade: number;
}

/** The `data-bkm-band` key of a span (core/hover/host-sync.ts springs each): `""` for one row either side. */
const spanKey = (span: number): string => (span <= 1 ? "" : `s${span}`);

/** The clip (or, with soft ends, mask) id of a band; the default band keeps the base id. */
export const bandClipId = (id: string, span: number, fade: number): string => (span <= 1 && fade <= 0 ? id : `${id}-s${span}f${Math.round(fade * 100)}`);

const bandRect = (span: number, attrs: Readonly<Record<string, string | number>> = {}): MarkupNode => el("rect", { "data-bkm-band": spanKey(span), height: 20000, width: 0, x: 0, y: -10000, ...attrs });

/** A soft-ended band (bklit highlight-segment.tsx `fadeLength`): a mask whose rect fades in and out over `fade`% of its width each side. */
const softBand = (id: string, { span, fade }: HighlightBand): MarkupNode[] => {
  const maskId = bandClipId(id, span, fade);
  const gradientId = `${maskId}-g`;
  const stop = (offset: number, opacity: number): MarkupNode => el("stop", { offset, "stop-color": "#fff", "stop-opacity": opacity });
  return [
    el("linearGradient", { id: gradientId, x1: 0, x2: 1, y1: 0, y2: 0 }, [stop(0, 0), stop(fade / 100, 1), stop(1 - fade / 100, 1), stop(1, 0)]),
    el("mask", { height: 40000, id: maskId, maskUnits: "userSpaceOnUse", width: 40000, x: -20000, y: -20000 }, [bandRect(span, { fill: `url(#${gradientId})` })]),
  ];
};

/** The band clip's hidden host, `id` its clipPath's; each wider or soft-ended highlight band (`bands`) adds its own clipPath or mask. */
export const highlightBandClip = (id: string, bands: readonly HighlightBand[] = []): MarkupNode =>
  el(
    "svg",
    { "aria-hidden": "true", focusable: "false", height: 0, width: 0 },
    [
      el("defs", {}, [
        el("clipPath", { clipPathUnits: "userSpaceOnUse", id }, [bandRect(1)]),
        ...bands.flatMap((band) =>
          band.fade > 0 ? softBand(id, band) : band.span > 1 ? [el("clipPath", { clipPathUnits: "userSpaceOnUse", id: bandClipId(id, band.span, 0) }, [bandRect(band.span)])] : [],
        ),
      ]),
    ],
    { style: HIDDEN_DEFS_STYLE, styleBefore: "width" },
  );

/** The distinct non-default bands of a chart's highlights. */
export const highlightBands = (highlights: readonly { readonly span?: number; readonly fade?: number }[]): HighlightBand[] => {
  const seen = new Map<string, HighlightBand>();
  for (const { span = 1, fade = 0 } of highlights) {
    if (span > 1 || fade > 0) {
      seen.set(`${span}:${fade}`, { span, fade });
    }
  }
  return [...seen.values()];
};
