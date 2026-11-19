import type { ReactElement } from "react";
import { CARRIER_ENABLE, CHART_ROLE } from "../core/carriers/roles";
import { useCarrierRegistration } from "./carrier-registry";

/** Marks a carrier whose props the chart reads through a function (gradients.ts: its `<stop>` children as the core's `stops`). */
export const CARRIER_READ = /* @__PURE__ */ Symbol.for("migrated.carrierRead");

export interface CarrierComponent<Props> {
  (props: Props): ReactElement | null;
  [CHART_ROLE]?: string;
  [CARRIER_READ]?: (props: Props) => Props;
  [CARRIER_ENABLE]?: () => void;
  displayName: string;
}

/**
 * A null-rendering component tagged with a role and display name; `read` gives its props as the chart reads them, when they differ from
 * the element's; `enable` hands the core the feature its role draws with (core/carriers/roles.ts `CARRIER_ENABLE`), called as the chart
 * reads it (read-children.ts) and as it registers from inside a wrapper.
 */
export const defineCarrier = <Props extends object>(role: string, displayName: string, read?: (props: Props) => Props, enable?: () => void): CarrierComponent<Props> =>
  Object.assign(
    (props: Props): ReactElement | null => {
      enable?.();
      // SAFETY: React hands a component its props object; carrier props are plain records.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      useCarrierRegistration(role, displayName, (read === undefined ? props : read(props)) as Readonly<Record<string, unknown>>);
      return null;
    },
    { [CHART_ROLE]: role, displayName, ...(read === undefined ? {} : { [CARRIER_READ]: read }), ...(enable === undefined ? {} : { [CARRIER_ENABLE]: enable }) },
  );
