/** A 40px margin around the editor (or its portaled menu). No new query or observer. */
export const ROOT_EDITOR_PROXIMITY_PX = 40;
export type PointerRect = Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom">;
export function rootPointerIsNear(x: number, y: number, rectangles: readonly PointerRect[], margin = ROOT_EDITOR_PROXIMITY_PX): boolean {
  return rectangles.some(({ left, right, top, bottom }) =>
    x >= left - margin && x <= right + margin && y >= top - margin && y <= bottom + margin);
}
