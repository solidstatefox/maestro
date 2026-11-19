import type { HeadLabel } from "./head-ease";

/** One label's walk: its node, its text at each commit step (COMMIT_MS each, from the tick's start; step 0's is the one the renderer
 * drew) up to `until`, and the box that sizes to the text. */
export interface LabelTrack {
  readonly node: Element;
  readonly textAt: (step: number) => string;
  /** The last step whose text can differ: the walk holds there. */
  readonly until: number;
  /** The badge's pill: its width follows the text (bklit's `length * 7.5 + 16`). */
  readonly box?: { readonly node: Element; readonly width: (text: string) => number };
}

/** A walk over a list of texts, each from the step it first shows at (head-ease.ts `headLabels`). */
export const stepsTrack = (node: Element, labels: readonly HeadLabel[], box?: LabelTrack["box"]): LabelTrack => ({
  node,
  textAt: (step) => labels.findLast((label) => label.step <= step)?.text ?? labels.at(0)?.text ?? "",
  until: labels.at(-1)?.step ?? 0,
  box,
});

const write = (node: Element, text: string): void => {
  const first = node.firstChild;
  if (first !== null && first.nodeType === 3 && first.nextSibling === null) {
    (first as Text).data = text;
    return;
  }
  node.textContent = text;
};

export interface LabelWalk {
  /** Writes each label's text at commit step `step` (only those that change); true while a label has a later text to show. */
  readonly apply: (step: number) => boolean;
}

/** The tick's label walks (the texts the renderer drew are step 0's). */
export function labelWalk(tracks: readonly LabelTrack[]): LabelWalk {
  const running = tracks.filter((track) => track.until > 0).map((track) => ({ track, text: track.textAt(0) }));
  return {
    apply: (step) => {
      let pending = false;
      for (const r of running) {
        const { node, box, textAt, until } = r.track;
        const text = textAt(Math.min(step, until));
        if (text !== r.text) {
          r.text = text;
          write(node, text);
          box?.node.setAttribute("width", String(box.width(text)));
        }
        pending ||= step < until;
      }
      return pending;
    },
  };
}
