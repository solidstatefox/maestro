import { Children, Fragment, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { isFunction, isRecord, isString } from "../core/guards";
import { CARRIER_ENABLE, CHART_ROLE } from "../core/carriers/roles";
import { declareAt } from "../core/carriers/table";
import type { ChildTable } from "../core/carriers/table";
import { CARRIER_READ } from "./role";

type CarrierProps = Record<string, unknown> & { children?: ReactNode };

const REACT_LAZY = /* @__PURE__ */ Symbol.for("react.lazy");

type ComponentType = ((...args: readonly unknown[]) => unknown) | Readonly<Record<string, unknown>>;

const asComponent = (type: unknown): ComponentType | undefined => (isFunction(type) || isRecord(type) ? type : undefined);

/**
 * The component behind an element type. Children passed from a React Server Component (e.g. `<Line>` written in a
 * Next.js page) arrive as `React.lazy` wrappers around the client component, so their role and name are invisible until
 * the wrapper is resolved. Resolving it the way React does lets the server render the chart; a module that is not loaded
 * yet throws, and the carrier is then picked up by registration after mount, as before.
 */
const componentOf = (type: unknown): ComponentType | undefined => {
  if (!(isRecord(type) && type.$$typeof === REACT_LAZY)) {
    return asComponent(type);
  }
  // React's lazy type carries `_init(_payload)`, which returns the loaded component or throws while it loads.
  // oxlint-disable-next-line eslint/no-underscore-dangle -- React's own lazy fields
  const { _init: init, _payload: payload } = type;
  if (!isFunction(init)) {
    return undefined;
  }
  try {
    return asComponent(init(payload));
  } catch {
    return undefined;
  }
};

export const roleOfType = (type: unknown): string | undefined => {
  const component = componentOf(type);
  if (component === undefined) {
    return undefined;
  }
  // SAFETY: a role is a plain own-property marker; reading it off any function or object is sound.
  const role = (component as { readonly [CHART_ROLE]?: unknown })[CHART_ROLE];
  return isString(role) ? role : undefined;
};

/** A carrier's props as the chart reads them (role.ts `defineCarrier`'s `read`), else the element's own. */
const carrierPropsOf = (type: unknown, props: CarrierProps): CarrierProps => {
  // SAFETY: the read function is a plain own-property marker, as the role is.
  const read = (componentOf(type) as { readonly [CARRIER_READ]?: unknown } | undefined)?.[CARRIER_READ];
  // SAFETY: `defineCarrier` stores a function of the carrier's own props, returning props of the same shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  return isFunction(read) ? (read(props) as CarrierProps) : props;
};

/** Hands the core the feature a carrier's role draws with (core/carriers/roles.ts `CARRIER_ENABLE`), before the chart builds with it. */
const enableCarrier = (type: unknown): void => {
  // SAFETY: the enable function is a plain own-property marker, as the role is.
  const enable = (componentOf(type) as { readonly [CARRIER_ENABLE]?: unknown } | undefined)?.[CARRIER_ENABLE];
  if (isFunction(enable)) {
    enable();
  }
};

/** Calls `visit` for each element child in JSX order (fragments flattened) with its top-level position, counted over every element. */
const forEachTopLevel = (children: ReactNode, visit: (child: ReactElement<CarrierProps>, position: number) => void): void => {
  let position = 0;
  const walk = (node: ReactNode): void => {
    Children.forEach(node, (child) => {
      if (!isValidElement<CarrierProps>(child)) {
        return;
      }
      if (child.type === Fragment) {
        walk(child.props.children);
        return;
      }
      visit(child, position);
      position += 1;
    });
  };
  walk(children);
};

export const readChildren = (children: ReactNode): ChildTable => {
  const table = new Map<string, Record<string, unknown>[]>();
  forEachTopLevel(children, (child, position) => {
    const role = roleOfType(child.type);
    if (role === undefined) {
      return;
    }
    enableCarrier(child.type);
    const props = declareAt(carrierPropsOf(child.type, child.props), position);
    const list = table.get(role);
    if (list === undefined) {
      table.set(role, [props]);
    } else {
      list.push(props);
    }
  });
  return table;
};

/** Children that are not config carriers (user components, custom SVG, a `useChart()` bridge) with their top-level position: rendered in the chart's SVG slot. */
export const customChildren = (children: ReactNode): { readonly position: number; readonly node: ReactElement }[] => {
  const out: { readonly position: number; readonly node: ReactElement }[] = [];
  forEachTopLevel(children, (child, position) => {
    if (roleOfType(child.type) === undefined) {
      out.push({ position, node: child });
    }
  });
  return out;
};

export const displayNameOf = (type: ReactElement["type"]): string | undefined => {
  const component = componentOf(type);
  if (component === undefined) {
    return undefined;
  }
  const displayName = "displayName" in component ? component.displayName : undefined;
  if (isString(displayName)) {
    return displayName;
  }
  return isString(component.name) ? component.name : undefined;
};
