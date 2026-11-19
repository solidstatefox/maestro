import { useSyncExternalStore } from "react";

const subscribeNever = (): (() => void) => () => undefined;

// False during SSR and hydration, true on a client mount.
export const useIsClient = (): boolean => useSyncExternalStore(subscribeNever, () => true, () => false);
