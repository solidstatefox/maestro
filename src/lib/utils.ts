export { cn } from "cn";

export function shortenCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "";
  if (num < 0) return "0";
  if (num >= 1_000_000_000) {
    return `${Math.floor(num / 1_000_000_000)}b`;
  }
  if (num >= 1_000_000) {
    return `${Math.floor(num / 1_000_000)}m`;
  }
  if (num >= 1_000) {
    return `${Math.floor(num / 1_000)}k`;
  }
  return String(Math.floor(num));
}
