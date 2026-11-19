"use client";
// The choropleth's public context in React: the chart provides its controller's at-rest context as a store (core/choropleth/controller.ts
// `contextAtRest`: it changes with the size, the zoom, the reveal and the props, never on hover), so a pan or zoom re-renders its readers,
// never the chart; each reader lays the hover store's and the ready gate's state over it (core/choropleth/context.ts `withHover`).
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { CHOROPLETH_CONTEXT_DEFAULT, withHover } from "../core/choropleth/context";
import type { Readable } from "../core/store";
import type { ChoroplethContextValue } from "./types";

const noopSubscribe = (): (() => void) => () => undefined;

/** A store that always holds `value`. */
const constant = <T,>(value: T): Readable<T> => ({ get: () => value, subscribe: noopSubscribe });

const DEFAULT_STORE: Readable<ChoroplethContextValue> = /* @__PURE__ */ constant(CHOROPLETH_CONTEXT_DEFAULT);

const ChoroplethContext = /* @__PURE__ */ createContext<Readable<ChoroplethContextValue>>(DEFAULT_STORE);

/** @internal */
const ChoroplethProvider = ({ children, value }: { readonly children: ReactNode; readonly value: ChoroplethContextValue }): ReactElement => {
  const store = useMemo(() => constant(value), [value]);
  return <ChoroplethContext.Provider value={store}>{children}</ChoroplethContext.Provider>;
};

/** Returns the map state: features, projection helpers, size, and the hovered feature. Call it inside a child of `ChoroplethChart`; outside one it returns empty defaults. */
const useChoropleth = (): ChoroplethContextValue => {
  const source = useContext(ChoroplethContext);
  const ctx = useSyncExternalStore(source.subscribe, source.get, source.get);
  const store = ctx.hoverStore;
  const version = useSyncExternalStore(store ? store.subscribe : noopSubscribe, () => store?.version ?? 0, () => 0);
  const loaded = useSyncExternalStore(ctx.readyStore ? ctx.readyStore.subscribe : noopSubscribe, () => ctx.readyStore?.get() ?? false, () => false);
  // `version` re-reads the hover store (core/choropleth/context.ts `withHover`) on each hover change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo((): ChoroplethContextValue => withHover(ctx, loaded), [ctx, store, version, loaded]);
};

export { ChoroplethContext, ChoroplethProvider, constant, useChoropleth };
