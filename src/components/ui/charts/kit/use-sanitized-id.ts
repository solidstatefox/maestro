import { useId } from "react";

export const useSanitizedId = (): string => useId().replaceAll(/[^a-zA-Z0-9_-]/gu, "");
