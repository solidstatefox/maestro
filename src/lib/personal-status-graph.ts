import { getUserGraph } from "@/lib/personal-sparql";

/** All mui:status triples (Record, Hidden and policy) live in this one graph. */
export function getPersonalStatusGraph(request: Request): string {
  return `${getUserGraph(request)}/status`;
}

/** Per-query observation metadata does not contain mui:status triples. */
export function getQueryObservationGraph(request: Request, hash: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid query observation hash.");
  return `${getUserGraph(request)}/status/${hash}`;
}
