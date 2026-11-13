/** Client transport shared by optional external-service features. */
export async function callOpenApiService<T>(
  service: string, operationId: string, parameters: Record<string, string> = {}, signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/proxy/api/service", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service, operationId, parameters }), signal,
  });
  if (!response.ok) throw new Error(`OpenAPI ${service}/${operationId}: HTTP ${response.status}`);
  return await response.json() as T;
}
