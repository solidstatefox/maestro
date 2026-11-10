/** Shared presentation of page numbers and totals. Pagination remains numeric internally. */
import { shortenCount } from "@/lib/utils";

export function formatPagePosition(pageIndex: number, totalPages?: number | null, hasMore = false): string {
  const position = shortenCount(Math.max(1, Math.floor(pageIndex) + 1));
  if (totalPages === null || totalPages === undefined) return `Page ${position}`;
  const total = shortenCount(Math.max(1, Math.floor(totalPages)));
  return `Page ${position} of ${total}${hasMore ? "+" : ""}`;
}
