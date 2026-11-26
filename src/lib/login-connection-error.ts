/** Diagnose only failed connection attempts. No authentication retry, no
 * credentials and no RDF operation are sent by the same-origin probe. */
export async function loginConnectionMessage(error:unknown, signal:AbortSignal,
  transport:typeof fetch=fetch):Promise<string> {
  const message=error instanceof Error ? error.message : "Personal connection failed.";
  const name=error instanceof Error ? error.name : "";
  const chunk=name==="ChunkLoadError" || /failed to load chunk|loading chunk .* failed|failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(message);
  const network=/^Maestro proxy unavailable \(|^(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|fetch failed|Network request failed)$/i.test(message);
  const timeout=name==="TimeoutError";
  if(signal.aborted)return "Connection cancelled.";
  if(!chunk && !network && !timeout)return message;
  const unreachable="Cannot reach the Maestro server. If it is stopped, start it again, reload this page and reconnect.";
  try {
    // Use an existing static asset, not a new endpoint or the graph server.
    // The short deadline bounds this diagnostic only, not a query or login.
    const response=await transport("/maestro-seed/manifest.json",{
      method:"HEAD",cache:"no-store",credentials:"omit",redirect:"error",
      signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),
    });
    if(signal.aborted)return "Connection cancelled.";
    if(response.status>=500)return `The Maestro server is temporarily unavailable (HTTP ${response.status}). Try again when it is running.`;
  } catch {
    return signal.aborted ? "Connection cancelled." : unreachable;
  }
  if(chunk)return "The Maestro page is out of date or an application module could not be loaded. Reload the page and reconnect.";
  if(timeout)return "The connection attempt timed out. Maestro is reachable; try connecting again.";
  return "Maestro is reachable again, but the connection was interrupted. Try connecting again.";
}
