import type { ChartPoint } from "@tanstack/charts";
import { isRecord } from "../guards";
import { writeDataTable } from "./data-table";
import type { ChartDataTableProps } from "./data-table";
import { rowText } from "./describe";
import type { ChartDescriber, ChartDescription } from "./describe";

/** What a family hands its surface for the screen-reader layer. */
export interface ChartA11yInput {
  /** The chart's description: the svg's summary, the data table, the keyboard announcements. */
  readonly describe?: ChartDescriber;
  /** The `<ChartDataTable>` child's props, when the chart has one. */
  readonly dataTable?: ChartDataTableProps;
}

const described = /* @__PURE__ */ new WeakMap<ChartDescriber, ChartDescription | null>();

/** The describer's description, built once per describer (a family makes a new describer when its data or options change). */
export const descriptionOf = (describe: ChartDescriber | undefined): ChartDescription | null => {
  if (describe === undefined) {
    return null;
  }
  if (!described.has(describe)) {
    let out: ChartDescription | null = null;
    try {
      out = describe();
    } catch {
      out = null;
    }
    described.set(describe, out);
  }
  return described.get(describe) ?? null;
};

/** The keyboard hint the summary ends with, on a chart TanStack lets the keyboard walk. */
export const KEYBOARD_HINT = "Use the arrow keys to move between data points.";

const SR_ONLY = "bkm-sr-only";
const ANNOUNCE_DELAY_MS = 120;
const TOOLTIP_SELECTOR = ".ts-chart-tooltip, [data-bkm-tooltip]";

const visible = (el: Element): boolean => {
  if (!(el instanceof HTMLElement) || el.hidden) {
    return false;
  }
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style !== undefined && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.05 && el.innerText.trim() !== "";
};

/** The visible tooltip's lines, as a sighted reader sees them. */
const tooltipLines = (root: Element): readonly string[] => {
  for (const el of root.querySelectorAll(TOOLTIP_SELECTOR)) {
    if (visible(el) && el instanceof HTMLElement) {
      const lines = el.innerText.split("\n").map((l) => l.trim()).filter((l) => l !== "");
      return lines.filter((l, i) => l !== lines[i - 1]);
    }
  }
  return [];
};

/** The description's row a focused point stands for: the row read from the point's datum. */
const rowFor = (description: ChartDescription, point: ChartPoint): number => {
  const datum = point.datum;
  if (datum === undefined) {
    return -1;
  }
  const own = description.rowOf?.(datum) ?? -1;
  if (own >= 0 && own < description.rows.length) {
    return own;
  }
  const direct = description.rows.findIndex((r) => r.datum === datum);
  if (direct !== -1) {
    return direct;
  }
  // A datum the definition wraps (a long-format row, a hierarchy node) carries the source row as `data` or `datum`.
  const inner = isRecord(datum) ? (datum.data ?? datum.datum) : undefined;
  return inner === undefined ? -1 : description.rows.findIndex((r) => r.datum === inner);
};

export interface ChartA11yLayer {
  /** After each render: the container the renderer drew into, its latest input, the chart's label and its ids' prefix. */
  update(container: HTMLElement, input: ChartA11yInput | undefined, ariaLabel: string | undefined, idPrefix: string): void;
  /** The renderer's focus moved (TanStack's `onFocusChange`): announced when the keyboard moved it. */
  focus(point: ChartPoint | null): void;
  /** The tooltip body's target changed (`onTooltipBodyChange`): the tooltip's status is hidden from assistive tech unless pinned. */
  tooltip(element: HTMLElement | null, pinned: boolean): void;
  destroy(): void;
}

export const createChartA11yLayer = (): ChartA11yLayer => {
  let container: HTMLElement | null = null;
  let root: HTMLElement | null = null;
  let live: HTMLElement | null = null;
  let toggle: HTMLButtonElement | null = null;
  let panel: HTMLElement | null = null;
  let input: ChartA11yInput | undefined;
  let label = "";
  let tableOf: ChartDescription | null = null;
  let tableCaption = "";
  let openState: boolean | null = null;
  let madeInert = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const description = (): ChartDescription | null => descriptionOf(input?.describe);

  const isOpen = (): boolean => {
    const props = input?.dataTable;
    if (props === undefined) {
      return false;
    }
    if (props.open !== undefined) {
      return props.open;
    }
    return props.toggle === true && (openState ?? props.defaultOpen === true);
  };

  const ensureRoot = (host: HTMLElement): HTMLElement => {
    if (root !== null && root.parentElement === host) {
      return root;
    }
    root?.remove();
    const doc = host.ownerDocument;
    root = doc.createElement("div");
    root.dataset.bkmA11y = "";
    live = doc.createElement("div");
    live.className = SR_ONLY;
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    root.append(live);
    host.append(root);
    toggle = null;
    panel = null;
    tableOf = null;
    return root;
  };

  const setInert = (on: boolean): void => {
    if (container !== null && on !== madeInert) {
      container.inert = on;
      madeInert = on;
    }
  };

  const sync = (idPrefix: string): void => {
    if (root === null || container === null) {
      return;
    }
    const props = input?.dataTable;
    const doc = root.ownerDocument;
    if (props === undefined) {
      toggle?.remove();
      panel?.remove();
      toggle = null;
      panel = null;
      tableOf = null;
      setInert(false);
      return;
    }
    const open = isOpen();
    const panelId = `${idPrefix}-data-table`;
    if (panel === null) {
      panel = doc.createElement("div");
      root.append(panel);
    }
    panel.id = panelId;
    panel.className = ["bkm-data-table", props.className].filter(Boolean).join(" ");
    panel.toggleAttribute("data-open", open);
    panel.classList.toggle(SR_ONLY, !open && props.toggle !== true);
    panel.hidden = !open && props.toggle === true;
    // The open table stands in for the chart: its svg and the hover layers under the panel leave the tab order and the accessibility tree.
    setInert(open);
    const current = description();
    const caption = props.caption ?? label;
    if (current !== null && (current !== tableOf || caption !== tableCaption)) {
      writeDataTable(panel, current, caption);
      tableOf = current;
      tableCaption = caption;
    }
    if (props.toggle === true) {
      if (toggle === null) {
        toggle = doc.createElement("button");
        toggle.type = "button";
        toggle.className = "bkm-data-table-toggle";
        toggle.addEventListener("click", () => {
          const next = !isOpen();
          if (input?.dataTable?.open === undefined) {
            openState = next;
          }
          input?.dataTable?.onOpenChange?.(next);
          sync(idPrefix);
        });
        root.insertBefore(toggle, panel);
      }
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-controls", panelId);
      toggle.textContent = open ? (props.hideLabel ?? "View as chart") : (props.showLabel ?? "View as table");
    } else {
      toggle?.remove();
      toggle = null;
    }
  };

  const say = (lines: readonly string[]): void => {
    if (live === null) {
      return;
    }
    const doc = live.ownerDocument;
    live.replaceChildren(
      ...lines.map((line) => {
        const div = doc.createElement("div");
        div.textContent = line;
        return div;
      }),
    );
  };

  return {
    update(nextContainer, nextInput, ariaLabel, idPrefix) {
      container = nextContainer;
      input = nextInput;
      label = ariaLabel ?? "";
      const host = nextContainer.parentElement;
      if (host === null) {
        return;
      }
      ensureRoot(host);
      sync(idPrefix);
    },
    focus(point) {
      if (container === null || live === null) {
        return;
      }
      clearTimeout(timer);
      const doc = container.ownerDocument;
      // Only the keyboard's moves are announced: a pointer's hover is seen.
      if (point === null || !container.contains(doc.activeElement)) {
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        const current = description();
        const at = current === null ? -1 : rowFor(current, point);
        if (current !== null && at !== -1) {
          say([rowText(current, current.rows[at])]);
          return;
        }
        const scope = container?.closest("[data-bkm-kit], [data-bkm-chart]") ?? container;
        const lines = scope === null ? [] : tooltipLines(scope);
        if (lines.length > 0) {
          say(lines);
        }
      }, ANNOUNCE_DELAY_MS);
    },
    tooltip(element, pinned) {
      const panelEl = element?.closest(".ts-chart-tooltip");
      if (panelEl instanceof HTMLElement) {
        // A pinned tooltip is a dialog the reader works in; otherwise the live region above says what it shows.
        if (pinned) {
          panelEl.removeAttribute("aria-hidden");
        } else {
          panelEl.setAttribute("aria-hidden", "true");
        }
      }
    },
    destroy() {
      clearTimeout(timer);
      setInert(false);
      root?.remove();
      root = null;
      live = null;
      toggle = null;
      panel = null;
      tableOf = null;
      container = null;
    },
  };
};
