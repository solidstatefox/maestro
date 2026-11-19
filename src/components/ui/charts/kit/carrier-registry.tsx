import { createContext, useContext, useId, useLayoutEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import type { Props } from "../core/carrier-props";
import { isProduction, warnOnce } from "../core/carriers/registry";
import type { CarrierRegistry } from "../core/carriers/registry";

const RegistryContext = /* @__PURE__ */ createContext<CarrierRegistry | null>(null);
const SlotContext = /* @__PURE__ */ createContext(0);

/** Scopes one custom child: its carriers register against `registry` at the child's top-level position. */
export const SlotScope = ({ registry, position, children }: Readonly<{ registry: CarrierRegistry; position: number; children: ReactNode }>): ReactElement => (
  <RegistryContext.Provider value={registry}>
    <SlotContext.Provider value={position}>{children}</SlotContext.Provider>
  </RegistryContext.Provider>
);

/** Rendered after every custom child: its layout effect runs after theirs, so the chart can wait for the first registrations. */
export const SettleMark = ({ registry }: Readonly<{ registry: CarrierRegistry }>): null => {
  useLayoutEffect(() => { registry.settle(); }, [registry]);
  return null;
};

/** What a carrier component calls: registers its props when it renders inside a custom child. */
export const useCarrierRegistration = (role: string, displayName: string, props: Props): void => {
  const registry = useContext(RegistryContext);
  const slot = useContext(SlotContext);
  const id = useId();
  useLayoutEffect(() => { registry?.set(id, role, slot, props); });
  useLayoutEffect(() => () => { registry?.remove(id); }, [registry, id]);
  if (registry === null && !isProduction()) {
    warnOnce(`<${displayName}> rendered outside a chart that reads wrapped children: it draws nothing. Keep it a direct child of the chart, or use a chart that supports wrapper components.`);
  }
};
