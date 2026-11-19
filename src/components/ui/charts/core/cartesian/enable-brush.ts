import { brushX } from "@tanstack/charts/interaction/brush";
import { registerBrushX } from "./brush-factory";

export const enableBrush = (): void => {
  registerBrushX(brushX);
};
