/** Shared, side-effect-free personal SPARQL endpoint policy. */
/** The login form supplies the public, read-only /sparql endpoint. Never
 * silently redirect personal SELECT/ASK reads to an authenticated write URL. */
export function personalReadEndpoint(session: { graphStore: string }): string {
  const url = new URL(session.graphStore.trim());
  if (!(["https:", "http:"].includes(url.protocol)) || !/\/sparql\/?$/i.test(url.pathname) || url.username || url.password) {
    throw new Error("Personal graph store must be the read-only /sparql HTTP(S) endpoint.");
  }
  return url.toString();
}

/** The login's authentication method is authoritative for updates. There is
 * no retry, endpoint guessing, or read-side rewriting. */
export function personalWriteEndpoint(session: {graphStore:string;authType?:string}): string {
  const read = new URL(personalReadEndpoint(session));
  if (!(["sparql-auth", "sparql-oauth", "sparql-webid"].includes(session.authType ?? ""))) {
    throw new Error("Select a personal SPARQL authentication method before writing.");
  }
  // This is the sole endpoint selection for writes: the method chosen at
  // login determines the matching Virtuoso authenticated service.
  read.pathname = read.pathname.replace(/\/sparql\/?$/i, `/${session.authType}`);
  return read.toString();
}

