import { ChartCrosshairView } from "./crosshair";
import { registerCrosshair } from "./features";

export const enableCrosshair = (): void => {
  registerCrosshair({ create: () => new ChartCrosshairView() });
};
