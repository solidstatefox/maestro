export const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** A local reference (`#id`) worth scoping; an absolute one isn't. */
export const isLocalRef = (value: unknown): value is string => isNonEmptyString(value) && value.startsWith("#");

// Scopes one consumer resource id to the mount so two charts never share an id.
export const scopedResourceId = (idPrefix: string, id: string): string =>
  id.startsWith(`${idPrefix}-`) ? id : `${idPrefix}-${id}`;

// Rewrites a local ref (#id) to the scoped id; absolute refs pass through.
export const scopedResourceRef = (idPrefix: string, ref: string): string =>
  ref.startsWith("#") ? `#${scopedResourceId(idPrefix, ref.slice(1))}` : ref;

// Rewrites url(#id) paints to the scoped id; solid paints pass through.
export const scopePaintUrl = (paint: string, idPrefix: string): string =>
  paint.replaceAll(/url\(#([^)]+)\)/gu, (_match: string, id: string) => `url(#${scopedResourceId(idPrefix, id)})`);
