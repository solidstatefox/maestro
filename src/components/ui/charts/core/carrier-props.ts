import { isFunction, isRecord } from "./guards";

const MAX_DEPTH = 12;

export type Props = Readonly<Record<string, unknown>>;

/** Structural equality for carrier props. Functions are never compared (inline formatters change identity every render), only their presence;
 * `trampolined` routes them through latest-ref trampolines. */
export const carrierEqual = (a: unknown, b: unknown, depth = 0): boolean => {
  if (Object.is(a, b)) {
    return true;
  }
  if (depth > MAX_DEPTH || a === null || b === null) {
    return false;
  }
  if (isFunction(a)) {
    return isFunction(b);
  }
  if (!(isRecord(a) && isRecord(b))) {
    return false;
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const keys = Object.keys(a).filter((key) => !key.startsWith("_"));
  const other = Object.keys(b).filter((key) => !key.startsWith("_"));
  if (keys.length !== other.length) {
    return false;
  }
  return keys.every((key) => key in b && carrierEqual(a[key], b[key], depth + 1));
};

export type Path = readonly (string | number)[];

// oxlint-disable-next-line anti-slop/no-unknown-returns -- walks an opaque prop tree; the leaf type is the caller's
const at = (root: unknown, path: Path): unknown => {
  let node = root;
  for (const key of path) {
    if (!isRecord(node)) {
      return undefined;
    }
    node = node instanceof Map ? node.get(key) : node[key];
  }
  return node;
};

export const isPlain = (value: Props): boolean => {
  if (Array.isArray(value)) {
    return true;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && !("$$typeof" in value);
};

/** Copy of `value` with every function replaced by a trampoline that calls whatever function currently sits at that path under `latest()`. */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- clones an opaque prop tree; values keep their runtime type
export const trampolined = (value: unknown, path: Path, latest: () => unknown): unknown => {
  if (isFunction(value)) {
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- forwards the wrapped function's own return value
    return (...args: unknown[]) => {
      const fn = at(latest(), path);
      return isFunction(fn) ? fn(...args) : undefined;
    };
  }
  if (!isRecord(value) || value instanceof Date || !isPlain(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => trampolined(item, [...path, i], latest));
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trampolined(item, [...path, key], latest)]));
};
