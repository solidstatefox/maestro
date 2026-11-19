export type StyleObject = Readonly<Record<string, string | number>>;

/** A px length as React writes a number: bare when it's 0. */
export const px = (length: number): string | number => (length === 0 ? 0 : `${length}px`);

const DASHED = /-([a-z])/g;

/** The style with React's property names (`font-weight` → `fontWeight`, `-webkit-user-select` → `WebkitUserSelect`); custom properties as written. */
export const toCamel = (style: StyleObject): Record<string, string | number> => {
  const out: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(style)) {
    out[name.startsWith("--") ? name : name.replaceAll(DASHED, (_dash, letter: string) => letter.toUpperCase())] = value;
  }
  return out;
};

/** The style as a `style` attribute's text, as React's server writes it (`name:value` joined by `;`, string values trimmed, empty ones left out). */
export const cssText = (style: StyleObject): string =>
  Object.entries(style)
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${name}:${typeof value === "number" ? value : value.trim()}`)
    .join(";");
