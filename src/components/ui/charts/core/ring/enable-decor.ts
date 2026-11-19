import { ringDecorScales, ringDecorVars, ringGridLayout, ringGridMarks, ringLabelMarks, ringLabelRows } from "./decor";
import { registerRingDecor } from "./features";

export const enableRingDecor = (): void => {
  registerRingDecor({ gridLayout: ringGridLayout, gridMarks: ringGridMarks, labelMarks: ringLabelMarks, labelRows: ringLabelRows, scales: ringDecorScales, vars: ringDecorVars });
};
