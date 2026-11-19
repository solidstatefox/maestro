import { useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { createCarrierRegistry, warnOnce } from "../core/carriers/registry";
import type { CarrierRegistry } from "../core/carriers/registry";
import type { ChildTable } from "../core/carriers/table";
import { SettleMark, SlotScope } from "./carrier-registry";
import { customChildren, displayNameOf, readChildren } from "./read-children";

// Elements that only exist in HTML: inside the chart's <svg> they draw nothing.
const HTML_ONLY = /* @__PURE__ */ new Set(["div", "span", "p", "button", "img", "ul", "ol", "li", "input", "label", "section", "table", "h1", "h2", "h3", "h4", "h5", "h6"]);

interface ChildTableResult {
  readonly table: ChildTable;
  /** Custom children (user components, SVG): render them in the chart's `<FocusLayer>` SVG slot. */
  readonly custom: ReactElement[];
  /** False until the first custom children have registered their carriers: hold the first definition for it. */
  readonly ready: boolean;
}

const useRegistry = (): CarrierRegistry => {
  const ref = useRef<CarrierRegistry | null>(null);
  ref.current ??= createCarrierRegistry();
  return ref.current;
};

/** The previous table while the carriers are structurally unchanged; its callbacks are trampolines reading the latest render's table through a ref.
 * `read` defaults to `readChildren`; a chart whose carriers nest (bar's <BarDepthProvider>) passes its own. */
export const useChildTable = (children: ReactNode, read: (children: ReactNode) => ChildTable = readChildren): ChildTableResult => {
  const registry = useRegistry();
  // Re-renders when a nested carrier registers; `table()` merges the registered ones.
  useSyncExternalStore(registry.subscribe, registry.snapshot, registry.snapshot);
  const settled = useSyncExternalStore(registry.subscribe, registry.settled, registry.settled);
  // The element tree's carriers plus the nested ones registered so far; the registry keeps the previous table while they are structurally unchanged.
  registry.setStatic(read(children));
  const table = registry.table();
  const custom = useMemo((): ReactElement[] => {
    const own = customChildren(children);
    if (own.length === 0) {
      return [];
    }
    for (const { node } of own) {
      if (typeof node.type === "string" && HTML_ONLY.has(node.type)) {
        warnOnce(`<${node.type}> is a chart child: children render inside the chart's <svg>, where HTML elements draw nothing. Wrap it in <foreignObject> or use an SVG element.`);
      }
    }
    return [
      ...own.map(({ node, position }) => <SlotScope key={position} registry={registry} position={position}>{node}</SlotScope>),
      <SettleMark key="settle" registry={registry} />,
    ];
  }, [children, registry]);
  return { table, custom, ready: settled || custom.length === 0 };
};

/** For charts that read carriers only: user components and custom SVG among the children are never rendered, so say so in development. */
export const warnUnrenderedChildren = (children: ReactNode, chart: string): void => {
  for (const { node } of customChildren(children)) {
    const name = typeof node.type === "string" ? node.type : displayNameOf(node.type) ?? "component";
    warnOnce(`<${name}> is a child of ${chart}, which reads only its own components (e.g. <Line>): wrapper components and custom SVG are not rendered there, so it is ignored.`);
  }
};
