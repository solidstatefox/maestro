/** Appbar presentation only. The live presentation actor remains authoritative. */
export type AppbarTabMode = "labels" | "icons" | "overflow";

export type AppbarTabWidths = Readonly<{
  labels: number;
  icons: number;
}>;

/**
 * Select a ribbon layout from the space remaining after navigation, the graph
 * editor (including its expanded width), and the right-hand toolbar.
 *
 * `availableWidth` must not include the currently rendered ribbon: otherwise
 * switching to a smaller ribbon makes the next measurement oscillate.
 */
export function selectAppbarTabMode(
  availableWidth: number,
  widths: AppbarTabWidths,
  clearance = 8,
): AppbarTabMode {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return "overflow";
  if (availableWidth >= widths.labels + clearance) return "labels";
  if (availableWidth >= widths.icons + clearance) return "icons";
  return "overflow";
}
