/** Effective query language. URL-only `lang` overrides the saved Sheet setting.
 * No language choice is ever written into FCT XML or a second persistent store. */
export const MAESTRO_LANG_PARAM = "lang";
export const MAESTRO_LANGUAGE_CHANGED = "maestro:language-url-changed";
let sheetLanguage = "en";

export function validMaestroLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const language = raw.trim().toLowerCase();
  return language === "all" || /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(language) ? language : null;
}

export function readUrlLanguage(): string | null {
  if (typeof window === "undefined") return null;
  return validMaestroLanguage(new URLSearchParams(window.location.search).get(MAESTRO_LANG_PARAM));
}

export function setSheetLanguage(language: string): void {
  sheetLanguage = validMaestroLanguage(language) ?? "en";
}

export function effectiveMaestroLanguage(): string {
  return readUrlLanguage() ?? sheetLanguage;
}

export function changeUrlLanguage(language: string | null): void {
  if (typeof window === "undefined") return;
  const value = language === null ? null : validMaestroLanguage(language);
  if (language !== null && !value) return;
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(MAESTRO_LANG_PARAM, value);
  else url.searchParams.delete(MAESTRO_LANG_PARAM);
  window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(MAESTRO_LANGUAGE_CHANGED));
}

/** Client execution context; the transport caches each effective language separately. */
export function maestroLanguageHeader(): string {
  return effectiveMaestroLanguage();
}
