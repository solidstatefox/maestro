import { useSyncExternalStore } from "react";

const subscribe = (): (() => void) => () => {};
const onClient = (): boolean => false;
const onServer = (): boolean => true;

/** True on the server and during hydration, false from the first client-only render (TanStack RendererChart's snapshot pattern). */
export const useHydrating = (): boolean => useSyncExternalStore(subscribe, onClient, onServer);

const HYDRATING_ATTRS = { "data-bkm-hydrating": "" } as const;

/**
 * Host attribute for the server markup: styles.css keeps it invisible (layout reserved) until the first client-only render, so the
 * server-painted finished chart never flashes before the entrance replays from empty (bklit cannot server-render, so its first visible
 * frame is the entrance). Client-only mounts never render it.
 */
export const useHydratingAttrs = (): typeof HYDRATING_ATTRS | undefined => (useHydrating() ? HYDRATING_ATTRS : undefined);
