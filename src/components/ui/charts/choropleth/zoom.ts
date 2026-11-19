"use client";

// Choropleth pan/zoom and the camera in React: the zoom facade and the camera API its controller builds (core/choropleth/controller.ts
// `zoom` and `camera`), each provided as a store, so a pan, a zoom or a flight re-renders their readers only.
import { createContext, useContext, useSyncExternalStore } from "react";
import { CAMERA_API_DEFAULT } from "../core/choropleth/camera";
import type { ChoroplethZoomContextValue } from "../core/choropleth/zoom";
import type { Readable } from "../core/store";
import type { ChoroplethCameraApi } from "../core/types/choropleth";

const noopSubscribe = (): (() => void) => () => undefined;
const NO_ZOOM: ChoroplethZoomContextValue = { zoom: null };
const ZOOM_DEFAULT: Readable<ChoroplethZoomContextValue> = { get: () => NO_ZOOM, subscribe: noopSubscribe };
const CAMERA_DEFAULT: Readable<ChoroplethCameraApi> = { get: () => CAMERA_API_DEFAULT, subscribe: noopSubscribe };

const ChoroplethZoomContext = /* @__PURE__ */ createContext<Readable<ChoroplethZoomContextValue>>(ZOOM_DEFAULT);
const ChoroplethCameraContext = /* @__PURE__ */ createContext<Readable<ChoroplethCameraApi>>(CAMERA_DEFAULT);

/** Returns the zoom controls (`{ zoom }`, with `scale`, `reset`, `translate` and the current `transformMatrix`) for building custom zoom buttons. `zoom` is `null` unless `zoomEnabled` is set on the chart. */
const useChoroplethZoom = (): ChoroplethZoomContextValue => {
  const store = useContext(ChoroplethZoomContext);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
};

/** Returns the click-to-zoom camera: `focusedKey`, `focusFeature`, `focusPoint`, `reset` and more, to read or drive it from your own components. Call it inside a child of `ChoroplethChart`. */
const useChoroplethCamera = (): ChoroplethCameraApi => {
  const store = useContext(ChoroplethCameraContext);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
};

export { ChoroplethCameraContext, ChoroplethZoomContext, useChoroplethCamera, useChoroplethZoom };
