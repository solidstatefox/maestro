/**
 * Node.js startup hook.
 *
 * Maestro no longer seeds anything at server startup: the personal graph server, its
 * credentials and the user's graph only exist once a user logs in. The ./graph
 * documents are loaded at login (Maestro graph-seed service) into
 * <graphPrefix>/query + the fragment from graph/manifest.json.
 */
import { registerMaestroTlsTrust } from "@/lib/maestro-tls-trust";

export async function registerNode() {
  // Node/Vercel cold-start only: extend the existing public CA store before
  // the proxy makes its first HTTPS request. No new route or request lifecycle.
  registerMaestroTlsTrust();
}
