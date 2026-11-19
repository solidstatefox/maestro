const UNITLESS = /* @__PURE__ */ new Set(["flex", "flex-grow", "flex-shrink", "font-weight", "line-height", "opacity", "order", "scale", "z-index", "zoom"]);
const UPPER = /[A-Z]/gu;
const VENDOR = /^(?:webkit|moz|ms|o)-/u;

const kebab = (name: string): string => {
  if (name.startsWith("--") || name.includes("-")) {
    return name;
  }
  const dashed = name.replaceAll(UPPER, (letter) => `-${letter.toLowerCase()}`);
  return VENDOR.test(dashed) ? `-${dashed}` : dashed;
};

const valueOf = (name: string, value: unknown): string | undefined => {
  if (typeof value === "number") {
    return UNITLESS.has(name) || name.startsWith("--") || value === 0 ? String(value) : `${value}px`;
  }
  return typeof value === "string" && value !== "" ? value : undefined;
};

/** The style's declarations, CSS's names, in order (a later one wins). */
export const panelDeclarations = (style: unknown): [string, string][] => {
  if (typeof style === "string") {
    return style.split(";").flatMap((part): [string, string][] => {
      const colon = part.indexOf(":");
      const name = part.slice(0, colon).trim();
      const value = part.slice(colon + 1).trim();
      return colon > 0 && name !== "" && value !== "" ? [[name, value]] : [];
    });
  }
  if (Array.isArray(style)) {
    return style.flatMap((part) => panelDeclarations(part));
  }
  if (typeof style !== "object" || style === null) {
    return [];
  }
  return Object.entries(style).flatMap(([key, raw]): [string, string][] => {
    const name = kebab(key);
    const value = valueOf(name, raw);
    return value === undefined ? [] : [[name, value]];
  });
};

/** Sets the style on the panel, after taking off the properties the last call set (`previous`); returns the ones it set. */
export const applyPanelStyle = (panel: HTMLElement, style: unknown, previous: readonly string[]): string[] => {
  for (const name of previous) {
    panel.style.removeProperty(name);
  }
  const declarations = panelDeclarations(style);
  for (const [name, value] of declarations) {
    panel.style.setProperty(name, value);
  }
  return declarations.map(([name]) => name);
};
