import { Children, useCallback, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { FocusStore } from "../../core/hover/focus-store";
import { ChartProvider } from "./chart-context";
import type { ChartContextValue } from "./chart-context";

/** Subscribe to the focus; only the calling component re-renders. */
function useFocused<T extends { readonly index: number }>(store: FocusStore<T>): T | null {
  const nothing = useCallback(() => null, []);
  return useSyncExternalStore(store.subscribe, store.get, nothing);
}

interface FocusLayerProps<T extends { readonly index: number }> {
  readonly store: FocusStore<T>;
  /** Called as a hook inside the layer: derive the public context for the current focus. */
  readonly useContextValue: (focused: T | null) => ChartContextValue;
  readonly children?: ReactNode;
}

/** Nothing to provide to without custom children: no subscription, so a focus change commits nothing here. */
export function FocusLayer<T extends { readonly index: number }>(props: FocusLayerProps<T>): ReactElement | null {
  return Children.count(props.children) > 0 ? <FocusProvider {...props} /> : null;
}

const SLOT_STYLE: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" };

function FocusProvider<T extends { readonly index: number }>({ store, useContextValue, children }: FocusLayerProps<T>): ReactElement {
  const focused = useFocused(store);
  const context = useContextValue(focused);
  return (
    <ChartProvider value={context}>
      <svg aria-hidden="true" data-bkm-slot="" style={SLOT_STYLE}>
        <g transform={`translate(${context.margin.left},${context.margin.top})`}>{children}</g>
      </svg>
    </ChartProvider>
  );
}
