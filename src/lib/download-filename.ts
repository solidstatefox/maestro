/** Cross-platform, human-readable basename for browser downloads.
 * Windows reserves device names, control chars, trailing spaces/dots and
 * <>:"/\\|?*; POSIX and macOS also forbid / and NUL. The same conservative
 * basename works on all three platforms. The extension is added by the caller.
 */
export function sanitizeDownloadFilename(value: string, fallback = "record"): string {
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._()-]/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  const shortened = Array.from(normalized).slice(0, 140).join("").replace(/[.\s-]+$/g, "");
  const clean = shortened || fallback;
  // Reserved with or without an extension; case-insensitive on Windows.
  return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(clean) ? `record-${clean}` : clean;
}
