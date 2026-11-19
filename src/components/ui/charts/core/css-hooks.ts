export const typedAttr = (css: string): string => `@supports (opacity: attr(opacity type(<number>), 1)){${css}}`;
