import { registerValueLabels } from "./features";
import { valueLabelsMark } from "./value-labels";

export const enableValueLabels = (): void => {
  registerValueLabels(valueLabelsMark);
};
