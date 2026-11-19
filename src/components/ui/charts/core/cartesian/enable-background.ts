import { backgroundResources } from "../markup/resources";
import { backgroundCss, backgroundMarks } from "./background";
import { registerBackground } from "./features";

export const enableBackground = (): void => {
  registerBackground({ marks: backgroundMarks, css: backgroundCss, resources: backgroundResources });
};
