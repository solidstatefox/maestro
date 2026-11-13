/**
 * Shared graph-server address matching for the FCT proxy and browser health gate.
 * An inferred HTTPS address may be used as HTTP, but an explicitly registered
 * HTTPS endpoint must never silently authorize another scheme or host.
 */
export function graphServerUrlMatches(configured: string, actual: string, schemeInferred = false): boolean {
  const normalize = (input: string): string => {
    try {
      const url = new URL(input);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return '';
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      return url.toString();
    } catch { return ''; }
  };
  const registered = normalize(configured);
  const requested = normalize(actual);
  if (!registered || !requested) return false;
  if (registered === requested) return true;
  return schemeInferred && (
    (registered.startsWith('https://') && requested === registered.replace(/^https:\/\//, 'http://')) ||
    (registered.startsWith('http://') && requested === registered.replace(/^http:\/\//, 'https://'))
  );
}
