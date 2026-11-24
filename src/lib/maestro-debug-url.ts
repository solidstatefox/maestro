/** Known opt-in diagnostic URL switches. Keep ordinary user settings out. */
export const MAESTRO_DEBUG_PARAMS = [
  { key: "maestroDebug", label: "Record performance", off: "", values: [{ value: "", label: "Off" }, { value: "record", label: "Record timing" }] },
  { key: "maestroLifecycle", label: "Application lifecycle", off: "", values: [{ value: "", label: "Off" }, { value: "1", label: "On (development only)" }] },
] as const;
export type MaestroDebugParam = (typeof MAESTRO_DEBUG_PARAMS)[number]["key"];
export function currentMaestroDebugSettings(url: string): Record<MaestroDebugParam, string> {
  const params = new URL(url).searchParams;
  return Object.fromEntries(MAESTRO_DEBUG_PARAMS.map(def => [def.key, params.get(def.key) ?? def.off])) as Record<MaestroDebugParam, string>;
}
/** Preserve q, addr, ui state, tabs, unrelated params, hash and origin exactly. */
export function urlWithMaestroDebugSettings(url: string, selections: Record<MaestroDebugParam, string>): string {
  const target = new URL(url);
  for (const definition of MAESTRO_DEBUG_PARAMS) {
    const selected = selections[definition.key];
    if (selected && definition.values.some(value => value.value === selected)) target.searchParams.set(definition.key, selected);
    else target.searchParams.delete(definition.key);
  }
  return target.toString();
}
