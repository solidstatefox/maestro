export const isNumber = (value: unknown): value is number => typeof value === "number";

export const isString = (value: unknown): value is string => typeof value === "string";

export const isFunction = (value: unknown): value is (...args: readonly unknown[]) => unknown => typeof value === "function";

/** Equal by `Object.is`, or equal timestamps for two Dates. */
export const sameValue = (a: unknown, b: unknown): boolean => Object.is(a, b) || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());

/** bklit's truthiness test on optional text: set and non-empty. */
export const hasText = (text: string | null | undefined): text is string => text !== undefined && text !== null && text !== "";

/** Finite number; keeps the checked type, so a `number | undefined` argument narrows to `number`. */
export const isFiniteNumber = <T>(value: T): value is T & number => isNumber(value) && Number.isFinite(value);

/** `parseFloat`, which tolerates trailing units ("300ms", "1.5x"); `Number()` would reject them. */
// oxlint-disable-next-line unicorn/prefer-number-coercion -- the partial parse is the point
export const leadingFloat = (text: string): number => Number.parseFloat(text);

/** Non-null object (arrays included). */
export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;
