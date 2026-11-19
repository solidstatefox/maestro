export interface Spring { readonly stiffness: number; readonly damping: number; readonly mass: number }

/** A critically damped spring (damping = 2·sqrt(stiffness·mass), mass 1) of undamped angular frequency `omega` (rad/s): no overshoot, the fastest settle for that stiffness. */
export const criticalSpring = (omega: number): Spring => ({ damping: 2 * omega, mass: 1, stiffness: omega * omega });

/** The snappy variant's angular frequency (rad/s): bklit's tooltipBoxSpring (100/20, ω = 10) played six times faster. */
export const SNAPPY_HOVER_OMEGA = 60;

/** The snappy variant's one hover-follow spring: 3600/120, critically damped. A pointer move of 30 / 100 / 300 px lands within 0.5 px in about 110 / 125 / 145 ms, with no overshoot. */
export const SNAPPY_HOVER_SPRING: Spring = /* @__PURE__ */ criticalSpring(SNAPPY_HOVER_OMEGA);

/** Duration (ms) of the snappy variant's hover transitions and tweens: `--bkm-hover-dur` in styles.css, whose `--bkm-hover-ease` is SNAPPY_HOVER_SPRING sampled over it. */
export const SNAPPY_HOVER_MS = 120;

/** `<duration> <easing>` of a CSS hover transition the kit writes from TS: the profile styles.css registers. */
export const HOVER_TRANSITION_CSS = "var(--bkm-hover-dur) var(--bkm-hover-ease)";

/** Crosshair indicator, tooltip dots, date pill: `tooltipSpring` (charts/chart-config-context.tsx:20; tooltip.tsx:12, charts/live-x-axis.tsx:12).
 * Snappy variant: SNAPPY_HOVER_SPRING (bklit: stiffness 300, damping 30). */
export const CROSSHAIR_SPRING: Spring = SNAPPY_HOVER_SPRING;

/**
 * How the crosshair (its rule, the tooltip dots on the line, the date pill under it) follows the pointer: `null` puts it on the focused point
 * at once, a spring glides it there (bklit: CROSSHAIR_SPRING). The tooltip panel keeps its own glide (TOOLTIP_BOX_SPRING), so the line tracks
 * the cursor exactly while the panel eases after it.
 */
export const CROSSHAIR_FOLLOW: Spring | null = null;

/** Floating tooltip panel: `tooltipBoxSpring` (charts/chart-config-context.tsx:21; tooltip.tsx:9).
 * Snappy variant: SNAPPY_HOVER_SPRING (bklit: stiffness 100, damping 20). */
export const TOOLTIP_BOX_SPRING: Spring = SNAPPY_HOVER_SPRING;

/** Hover-highlight band (x and width): `highlightSpring` (charts/chart-config-context.tsx:22; use-highlight-segment.ts:44-57); also line-chart.tsx:370's dash offsets.
 * Snappy variant: SNAPPY_HOVER_SPRING (bklit: stiffness 180, damping 28). */
export const HIGHLIGHT_SPRING: Spring = SNAPPY_HOVER_SPRING;

/** The date ticker's month and day stacks: `useSpring(0, { stiffness: 400, damping: 35 })` (charts/tooltip/date-ticker.tsx:81-82).
 * Snappy variant: SNAPPY_HOVER_SPRING (bklit: stiffness 400, damping 35). */
export const DATE_PILL_SPRING: Spring = SNAPPY_HOVER_SPRING;

/** Shared hover spring of pie slices, ring arcs and radar series (charts/pie-slice.tsx:163, charts/ring.tsx:185, charts/radar-area.tsx:164).
 * Snappy variant: SNAPPY_HOVER_SPRING (bklit: stiffness 400, damping 25). */
export const HOVER_SPRING: Spring = SNAPPY_HOVER_SPRING;

/** Live y-axis tick glide and fade (charts/live-y-axis.tsx:89). */
export const LIVE_Y_TICK_SPRING: Spring = { damping: 24, mass: 1, stiffness: 180 };

// ChartMarkers cluster (charts/markers/marker-group.tsx): every spring here is a hover's (the cluster fans while hovered; the action disc lifts and presses).
/** Body fanned variant {scale .6, opacity 0, blur 2px}, delayed by animationDuration + groupIndex * 100ms (:232-234).
 * Snappy variant: SNAPPY_HOVER_SPRING (bklit: stiffness 300, damping 25). */
export const MARKER_BODY_SPRING: Spring = SNAPPY_HOVER_SPRING;
/** Badge exit {scale 0, opacity 0} (:265); the fanned centre dot {scale 1, opacity .5} shares it (:382).
 * Snappy variant: SNAPPY_HOVER_SPRING (bklit: stiffness 400, damping 20). */
export const MARKER_BADGE_SPRING: Spring = SNAPPY_HOVER_SPRING;
/** Fan discs {scale 1, opacity 1}, delayed index * 40ms (:347).
 * Snappy variant: SNAPPY_HOVER_SPRING (bklit: stiffness 400, damping 22). */
export const MARKER_ITEM_SPRING: Spring = SNAPPY_HOVER_SPRING;
/** Action disc (:505-511): hover scale 1.15 with a lifted shadow, press 0.95, the live velocity kept across states.
 * Snappy variant: SNAPPY_HOVER_SPRING (bklit: stiffness 400, damping 17). */
export const MARKER_ACT_SPRING: Spring = SNAPPY_HOVER_SPRING;
