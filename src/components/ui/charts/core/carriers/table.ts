export type ChildTable = ReadonlyMap<string, readonly Record<string, unknown>[]>;

/** The table of a chart that takes no carriers (Gauge, FunnelChart). */
export const NO_CARRIERS: ChildTable = /* @__PURE__ */ new Map();

// Declaration position of each carrier's props: its element's top-level position (bklit paints children in JSX order).
const declarationIndex = /* @__PURE__ */ new WeakMap<WeakKey, number>();

/** Registered carriers (rendered inside user components) merged into the static table at their declaration position. */
export const declareAt = <T extends WeakKey>(props: T, position: number): T => {
  declarationIndex.set(props, position);
  return props;
};

export const declarationOf = (props: WeakKey): number => declarationIndex.get(props) ?? Number.POSITIVE_INFINITY;

/** A derived copy of a carrier's props keeps its declaration position. */
export const keepDeclarationIndex = <T extends WeakKey>(from: WeakKey, to: T): T => {
  const at = declarationIndex.get(from);
  if (at !== undefined) {declarationIndex.set(to, at);}
  return to;
};

/** True when `props` was declared before every carrier of `roles` (or no such carrier exists). */
export const declaredBefore = (table: ChildTable, props: WeakKey, roles: readonly string[]): boolean => {
  const at = declarationIndex.get(props) ?? Number.POSITIVE_INFINITY;
  return roles.every((role) => (table.get(role) ?? []).every((other) => at < (declarationIndex.get(other) ?? Number.POSITIVE_INFINITY)));
};

/** All props for one role, typed by the caller. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the role's prop shape
export const propsFor = <Props>(table: ChildTable, role: string): readonly Props[] =>
  // SAFETY: the role is the discriminant; carriers of one role always share one prop shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  (table.get(role) ?? []) as readonly Props[];
