export const hostPointerMove = (_target: Node | Window): "pointermove" => "pointermove";

/** `definition` as the host gets it: unchanged, so the host follows `pointermove` (TanStack's default). */
export const withHostPointer = <T>(definition: T): T => definition;
