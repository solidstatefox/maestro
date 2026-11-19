export interface BarGrow {
  /** The arm's `performance.now()` until `settle`, else null: the bar mark `motion` and the wipe resume from it. */
  readonly growing: { readonly current: number | null };
  /** The reveal arm fired: the next build (entered) grows the bars from now. */
  arm(): void;
  /** The entered build is drawn: later updates run unstaggered. */
  settle(): void;
}

export function createBarGrow(): BarGrow {
  const growing: { current: number | null } = { current: null };
  return {
    growing,
    arm() {
      growing.current = performance.now();
    },
    settle() {
      growing.current = null;
    },
  };
}
