import { registerBackdrop, registerTrend } from "./features";
import { backdropMarks, trendMarks } from "./series-layers";

export const enableLineBackdrop = (): void => {
  registerBackdrop({ marks: backdropMarks });
};

export const enableTrendLine = (): void => {
  registerTrend({ marks: trendMarks });
};
