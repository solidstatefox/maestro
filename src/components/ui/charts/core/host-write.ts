export function raiseAttribute(host: HTMLElement | null | undefined, name: string): void {
  if (host !== null && host !== undefined && !host.hasAttribute(name)) {
    host.setAttribute(name, "");
  }
}

/** Sets the CSS var `name` on the host unless it already holds `value`. */
export function writeVar(host: HTMLElement, name: string, value: string): void {
  if (host.style.getPropertyValue(name) !== value) {
    host.style.setProperty(name, value);
  }
}

/** Sets attribute `name` to `value` unless the host already holds it. */
export function writeAttribute(host: HTMLElement, name: string, value: string): void {
  if (host.getAttribute(name) !== value) {
    host.setAttribute(name, value);
  }
}

/** Removes attribute `name` when the host carries it. */
export function clearAttribute(host: HTMLElement | null | undefined, name: string): void {
  if (host?.hasAttribute(name) === true) {
    host.removeAttribute(name);
  }
}

/** Presence attribute `name` on the host, set when `present` and removed otherwise (skipped when already so). */
export function writePresence(host: HTMLElement | null | undefined, name: string, present: boolean): void {
  if (present) { raiseAttribute(host, name); } else { clearAttribute(host, name); }
}

/** Removes the CSS var `name` when the host holds a value for it. */
export function clearVar(host: HTMLElement | null | undefined, name: string): void {
  if (host !== null && host !== undefined && host.style.getPropertyValue(name) !== "") {
    host.style.removeProperty(name);
  }
}

/** Focus state of a chart host: `data-bkm-on` while a point is focused, `data-bkm-hover` (and `--bkm-hx` when `hoverX` is given) while the hover dim is live; `liftPress` also drops `data-bkm-press` on focus. */
export function writeFocusHost(host: HTMLElement, state: { readonly focused: boolean; readonly hovered: boolean; readonly hoverX?: string; readonly liftPress?: boolean }): void {
  if (state.focused) {
    raiseAttribute(host, "data-bkm-on");
    if (state.liftPress === true) {
      clearAttribute(host, "data-bkm-press");
    }
  } else {
    clearAttribute(host, "data-bkm-on");
  }
  if (state.hovered) {
    if (state.hoverX !== undefined) {
      writeVar(host, "--bkm-hx", state.hoverX);
    }
    raiseAttribute(host, "data-bkm-hover");
  } else {
    clearAttribute(host, "data-bkm-hover");
  }
}

const HOVER_ATTR = "data-hover";

/** Writes the hovered index onto the host as `data-hover` (null clears it). */
export function writeHoverIndex(host: HTMLElement, index: number | null): void {
  if (index === null) { clearAttribute(host, HOVER_ATTR); } else { writeAttribute(host, HOVER_ATTR, String(index)); }
}

/** The index painted by `writeHoverIndex`, or null when the host carries none. */
export function readHoverIndex(host: HTMLElement): number | null {
  const painted = host.getAttribute(HOVER_ATTR);
  return painted === null || Number.isNaN(Number(painted)) ? null : Number(painted);
}
