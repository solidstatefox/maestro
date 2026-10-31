/**
 * Node.js startup hook.
 *
 * Maestro no longer seeds anything at server startup: the personal graph server, its
 * credentials and the user's graphsite only exist once a user logs in. The ./graph
 * documents are loaded at login (POST /proxy/api/graph-seed) into
 * <graphsitePrefix>/query + the fragment from graph/manifest.json.
 */
export async function registerNode() {
  // Intentionally empty.
}
