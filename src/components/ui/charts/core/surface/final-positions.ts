import { erase } from "../erase";
import type { AnyRenderer, AnySurface } from "../erased-types";

const wrapped = new WeakMap<AnyRenderer, AnyRenderer>();
const kept = new WeakSet<AnyRenderer>();

const noPresentation = (): undefined => undefined;
const noSubscription = (): (() => void) => () => undefined;

/** Marks `renderer` to keep hit-testing its in-flight geometry (`finalPositions` returns it as is). */
export function keepPresentation<R extends AnyRenderer>(renderer: R): R {
  kept.add(renderer);
  return renderer;
}

/** `renderer` with surfaces that hit-test the final positions; the same wrapper for the same renderer, so the host never remounts. */
export function finalPositions<R extends AnyRenderer | undefined>(renderer: R): R {
  if (renderer === undefined || kept.has(renderer)) {
    return renderer;
  }
  let out = wrapped.get(renderer);
  if (out === undefined) {
    const inner = renderer;
    const self: AnyRenderer = {
      id: inner.id,
      capabilities: inner.capabilities,
      prerender: (scene, options) => inner.prerender(scene, options),
      mount: (container, requestRender) => {
        const surface: AnySurface = inner.mount(container, requestRender);
        // The host checks `surface.renderer` against the renderer it resolved (a mismatch remounts), so the surface reports the wrapper.
        return new Proxy(surface, {
          get: (target, key) => {
            if (key === "renderer") { return self; }
            if (key === "getPresentationPoints") { return noPresentation; }
            if (key === "subscribePresentationPoints") { return noSubscription; }
            return Reflect.get(target, key, target);
          },
        });
      },
    };
    wrapped.set(renderer, self);
    out = self;
  }
  return erase(out);
}
