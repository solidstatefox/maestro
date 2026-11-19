"use client";

// bklit's `useSankey()` context over the native chart: the controller's `context` (core/sankey/controller.ts), provided by
// <SankeyContextLayer>, the only subscriber to its hover.
import { createContext, useContext, useLayoutEffect, useReducer, useSyncExternalStore } from "react";
import type { Dispatch, ReactElement, ReactNode, RefObject, SetStateAction } from "react";
import type { SankeyController } from "../core/sankey/controller";
import type { SankeyTooltipData, SankeyContextValue as CoreSankeyContextValue } from "../core/types/sankey";

/** Value returned by `useSankey()`. */
export interface SankeyContextValue extends CoreSankeyContextValue<RefObject<HTMLDivElement | null>, Dispatch<SetStateAction<SankeyTooltipData | null>>> {}

const SankeyContext = /* @__PURE__ */ createContext<SankeyContextValue | null>(null);

/** @internal */
export const SankeyProvider = ({ children, value }: { readonly children: ReactNode; readonly value: SankeyContextValue }): ReactElement => (
  <SankeyContext.Provider value={value}>{children}</SankeyContext.Provider>
);

/** Returns the chart state and layout. Call it inside a child of `SankeyChart`; it throws elsewhere. */
export function useSankey(): SankeyContextValue {
  const context = useContext(SankeyContext);
  if (!context) {
    throw new Error("useSankey must be used within a SankeyProvider");
  }
  return context;
}

const noFocus = (): null => null;
const count = (n: number): number => n + 1;

/** Provides `useSankey()` to the chart's children. A hover focus re-renders them at once (a store read); the measured size, the ready flag and
 * the reveal epoch land on the default lane, as bklit's state does (react-use-measure, isLoaded), `data-bkm-ready` in the commit that renders
 * the flag. Subscribing makes the controller's context live (its size observer and ready gate), so the chart renders this layer only for
 * children beyond the config carriers. */
export const SankeyContextLayer = ({ controller, children }: { readonly controller: SankeyController<ReactNode>; readonly children?: ReactNode }): ReactElement => {
  useSyncExternalStore(controller.focus.subscribe, controller.focus.get, noFocus);
  const [, landed] = useReducer(count, 0);
  useLayoutEffect(() => controller.context.subscribe(landed), [controller]);
  useLayoutEffect(() => { controller.contextCommitted(); });
  return <SankeyProvider value={controller.context.get()}>{children}</SankeyProvider>;
};
