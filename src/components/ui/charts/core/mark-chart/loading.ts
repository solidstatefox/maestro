import { bonePulseTiming, BONE_CLASS, BONE_PULSE, SKELETON_CONCEAL_EASE, SKELETON_CONCEAL_MS, SKELETON_FADE_EASE, SKELETON_FADE_MS, SKELETON_KEY } from "./skeleton";

const OVERLAY_CLASS = "bkm-mc-overlay";
/** What the copy must not keep: the chart's name and focus stop are the renderer's svg's alone. */
const DROPPED_ATTRS = ["aria-label", "aria-roledescription", "aria-describedby", "aria-description", "role", "tabindex", "id"] as const;

export interface MarkLoadingLayer {
  /** Before the draw that swaps the chart for its skeleton: copies the drawn chart over itself and fades the copy out. */
  conceal(surface: HTMLElement): void;
  /** The chart turned ready (or detached): the copy goes at once. */
  clear(): void;
  /** After a loading draw (the renderer's `onRender`, before the paint): fades a new skeleton in and starts each new bone's pulse.
   * `phases` is each bone's place in the wave, by its scene key. */
  drawn(container: Element, phases: ReadonlyMap<string, number>): void;
}

const canAnimate = (el: Element): boolean => typeof el.animate === "function";

const chartSvgOf = (surface: HTMLElement): SVGSVGElement | null => {
  const first = surface.firstElementChild;
  return first instanceof SVGSVGElement ? first : null;
};

export function createMarkLoadingLayer(): MarkLoadingLayer {
  let overlay: SVGSVGElement | null = null;
  let fade: Animation | null = null;
  /** The skeleton waits this long in the draw after a conceal. */
  let wait = 0;
  const shown = new WeakSet<Element>();
  const pulsing = new WeakSet<Element>();

  const clear = (): void => {
    fade?.cancel();
    fade = null;
    overlay?.remove();
    overlay = null;
  };

  return {
    conceal(surface) {
      const svg = chartSvgOf(surface);
      if (svg === null || !canAnimate(svg)) { return; }
      clear();
      const copy = svg.cloneNode(true);
      if (!(copy instanceof SVGSVGElement)) { return; }
      for (const name of DROPPED_ATTRS) { copy.removeAttribute(name); }
      copy.setAttribute("class", OVERLAY_CLASS);
      copy.setAttribute("aria-hidden", "true");
      // The copy is no part of the scene: no key for the controller's lookups, no lit item.
      for (const el of copy.querySelectorAll("[data-ts-key], [data-bkm-on]")) {
        el.removeAttribute("data-ts-key");
        el.removeAttribute("data-bkm-on");
      }
      svg.after(copy);
      overlay = copy;
      const animation = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SKELETON_CONCEAL_MS, easing: SKELETON_CONCEAL_EASE, fill: "forwards" });
      fade = animation;
      animation.addEventListener("finish", () => {
        if (fade === animation) { clear(); }
      });
      wait = SKELETON_CONCEAL_MS;
    },
    clear() {
      clear();
      wait = 0;
    },
    drawn(container, phases) {
      const delay = wait;
      wait = 0;
      const skeleton = container.querySelector(`[data-ts-key="${SKELETON_KEY}"]`);
      if (skeleton === null) { return; }
      if (!shown.has(skeleton) && canAnimate(skeleton)) {
        shown.add(skeleton);
        skeleton.animate([{ opacity: 0 }, { opacity: 1 }], { delay, duration: SKELETON_FADE_MS, easing: SKELETON_FADE_EASE, fill: "backwards" });
      }
      for (const bone of skeleton.querySelectorAll(`.${BONE_CLASS}`)) {
        if (pulsing.has(bone) || !canAnimate(bone)) { continue; }
        pulsing.add(bone);
        bone.animate(BONE_PULSE, bonePulseTiming(phases.get(bone.getAttribute("data-ts-key") ?? "") ?? 0, delay));
      }
    },
  };
}
