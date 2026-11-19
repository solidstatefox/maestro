export { cn } from "@/lib/utils";

export const joinClasses = (...parts: readonly (string | false | undefined)[]): string =>
  parts.filter((part) => part !== undefined && part !== false && part !== "").join(" ");
