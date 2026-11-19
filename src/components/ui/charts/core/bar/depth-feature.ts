import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { buildDepthMarks, depthBarMark } from "./depth";

interface DepthFeature {
  readonly marks: typeof buildDepthMarks;
  readonly bar: typeof depthBarMark;
}

let feature: DepthFeature | undefined;

export const registerDepth = (next: DepthFeature): void => {
  feature = next;
};

/** Whether the bars get their top trimmed by the perspective rise (Provider or Back present). */
export const hasDepth = (table: ChildTable): boolean => propsFor(table, "barDepthBack").length > 0 || propsFor(table, "barDepthProvider").length > 0;

export const depthMarksFor = (...args: Parameters<typeof buildDepthMarks>): ReturnType<typeof buildDepthMarks> | undefined => feature?.marks(...args);
export const depthBarFor = (...args: Parameters<typeof depthBarMark>): ReturnType<typeof depthBarMark> | undefined => feature?.bar(...args);
