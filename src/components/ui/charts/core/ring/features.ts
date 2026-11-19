import type { StyleObject } from "../style";
import type { RingGridProps, RingLabelsProps } from "../types/ring";
import type { RingDecorGeometry, RingGridLayout, RingLabelRow, ringDecorScales, ringDecorVars, ringGridMarks, ringLabelMarks } from "./decor";

export interface RingDecorFeature {
  readonly gridLayout: (props: Readonly<RingGridProps>, geometry: Readonly<RingDecorGeometry>) => RingGridLayout | null;
  readonly labelRows: (props: Readonly<RingLabelsProps>, geometry: Readonly<RingDecorGeometry>) => { readonly rows: readonly RingLabelRow[]; readonly fontSize: number };
  readonly gridMarks: typeof ringGridMarks;
  readonly labelMarks: typeof ringLabelMarks;
  readonly scales: typeof ringDecorScales;
  readonly vars: (input: Parameters<typeof ringDecorVars>[0]) => StyleObject;
}

let decorFeature: RingDecorFeature | undefined;

/** Registers the decor (enable-decor.ts); every later chart draws a RingGrid or RingLabels it is given. */
export const registerRingDecor = (feature: RingDecorFeature): void => {
  decorFeature = feature;
};

/** The registered decor, or undefined while no decor carrier has been used (the carriers draw nothing then). */
export const ringDecor = (): RingDecorFeature | undefined => decorFeature;
