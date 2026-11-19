import { isFunction, isRecord, isString } from "../guards";
import { CHART_ROLE } from "../carriers/roles";

/** Role tag set by the choropleth carrier components. */
export const roleOf = (type: unknown): string | undefined => {
  if (!(isFunction(type) || isRecord(type))) {
    return undefined;
  }
  const role: unknown = CHART_ROLE in type ? type[CHART_ROLE] : undefined;
  return isString(role) ? role : undefined;
};
