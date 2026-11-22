/** Fingerprint a destination graph from the content hashes of its seed assets.
 *
 * The static build already computes each asset's SHA-256, which is also used
 * for mui:implementationDigest and versioned curator approvals. Reuse those
 * canonical digests for graph change detection, without importing approval
 * policy or rehashing Turtle/XSLT in the browser.
 *
 * A destination-specific runtime endpoint is included only for assets whose
 * RDF content depends on the current personal graph server address.
 */
export async function destinationSeedDigest(
  assets: readonly {file: string; digest: string}[],
  embeddedEndpoint?: string,
): Promise<string> {
  const components = assets.map(({file, digest}) => `${file}\u0000${digest}`);
  if (embeddedEndpoint !== undefined) components.push(embeddedEndpoint);
  const bytes = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(JSON.stringify(components)),
  );
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
