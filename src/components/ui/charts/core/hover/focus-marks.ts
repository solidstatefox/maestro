export const FOCUS_MARK = "data-bkm-f";

export interface FocusMarks {
  /** Marks the nodes under `root` matching `selector` (null clears every mark); a repeat of the current focus writes nothing. */
  set(root: ParentNode | null, selector: string | null): void;
  /** Re-applies the current focus's marks (after a render replaced or stripped the nodes). */
  refresh(): void;
}

export function createFocusMarks(): FocusMarks {
  let root: ParentNode | null = null;
  let selector: string | null = null;
  let marked: readonly Element[] = [];
  const apply = (): void => {
    const next = root !== null && selector !== null ? Array.from(root.querySelectorAll(selector)) : [];
    for (const el of marked) {
      if (!next.includes(el)) {
        el.removeAttribute(FOCUS_MARK);
      }
    }
    for (const el of next) {
      if (!el.hasAttribute(FOCUS_MARK)) {
        el.setAttribute(FOCUS_MARK, "");
      }
    }
    marked = next;
  };
  return {
    set(nextRoot, nextSelector) {
      if (nextRoot === root && nextSelector === selector) {
        return;
      }
      root = nextRoot;
      selector = nextSelector;
      apply();
    },
    refresh() {
      if (selector !== null || marked.length > 0) {
        apply();
      }
    },
  };
}
