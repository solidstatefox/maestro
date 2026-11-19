export function erase(value: unknown): never {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- the one erasure point, justified above
  return value as never;
}
