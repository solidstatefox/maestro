/** Client-side selection IDs only; actual providers and stylesheets remain SHACL-discovered. */
export const PERSONAL_PERSPECTIVE_URI = {
  bookmarks: "gttp://ggg.maestro.ecosys/shacl/provider/bookmarks-perspective",
  history: "gttp://ggg.maestro.ecosys/shacl/provider/history-perspective",
} as const;
export type PersonalPerspectiveKind = keyof typeof PERSONAL_PERSPECTIVE_URI;
export function personalPerspectiveFromUri(uri: string): PersonalPerspectiveKind | null {
  if (uri === PERSONAL_PERSPECTIVE_URI.bookmarks) return "bookmarks";
  if (uri === PERSONAL_PERSPECTIVE_URI.history) return "history";
  return null;
}
