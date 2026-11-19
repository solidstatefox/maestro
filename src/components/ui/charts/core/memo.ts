export function memoCell<T>(): (deps: readonly unknown[], compute: () => T) => T {
  let held: { readonly deps: readonly unknown[]; readonly value: T } | undefined;
  return (deps, compute) => {
    if (held !== undefined && held.deps.length === deps.length && held.deps.every((dep, i) => Object.is(dep, deps[i]))) {
      return held.value;
    }
    const value = compute();
    held = { deps, value };
    return value;
  };
}

/** Keeps the first value seen for a structural `key`, so identity only changes when content does. */
export function structuralCell<T>(): (value: T, key: string) => T {
  let held: { readonly key: string; readonly value: T } | undefined;
  return (value, key) => {
    if (held === undefined || held.key !== key) {
      held = { key, value };
    }
    return held.value;
  };
}
