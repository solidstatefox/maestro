"use client";

/** Page sizes partition the active server batch into five equal fractions. */
export function pageSizesForBatch(batchSize: number): number[] {
  const batch = Math.max(5, Math.floor(batchSize));
  return Array.from({ length: 5 }, (_, index) => Math.max(1, Math.floor(batch * (index + 1) / 5)));
}
