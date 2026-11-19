const CONTRIBUTION_LEVEL_1_MAX = 1;
const CONTRIBUTION_LEVEL_2_MAX = 2;
const CONTRIBUTION_LEVEL_3_MAX = 3;
const CONTRIBUTION_LEVEL_4_MAX = 4;

/** Discrete 5-level threshold scale (0-4), not a continuous interpolation. */
export const getHeatmapContributionLevel = (count: number): number => {
  if (count <= 0) {return 0;}
  if (count === CONTRIBUTION_LEVEL_1_MAX) {return CONTRIBUTION_LEVEL_1_MAX;}
  if (count === CONTRIBUTION_LEVEL_2_MAX) {return CONTRIBUTION_LEVEL_2_MAX;}
  if (count === CONTRIBUTION_LEVEL_3_MAX) {return CONTRIBUTION_LEVEL_3_MAX;}
  return CONTRIBUTION_LEVEL_4_MAX;
}
