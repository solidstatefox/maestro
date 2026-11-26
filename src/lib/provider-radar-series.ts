import type { ProviderRadar } from "./provider-page-program";

/** Equal coordinates produce the exact same polygon, even with distinct series IDs. */
export function coincidentRadarSeries(chart: ProviderRadar): string[][] {
  const groups = new Map<string, string[]>();
  for (const member of chart.members) {
    const signature = JSON.stringify(chart.chart.map(axis => axis[member.key]));
    const group = groups.get(signature) ?? [];
    group.push(member.key);
    groups.set(signature, group);
  }
  return [...groups.values()].filter(group => group.length > 1);
}
