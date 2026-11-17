/** Shared persistence projection of the RDF/XState transition delta.
 * No status/state name or event is hard-coded here. Each update is scoped to
 * the transition's one RDF track and conditioned on its observed source state,
 * so a late update cannot unconditionally overwrite a different status. */
import type { CompiledStatusMachine, StatusTransition } from "@/lib/status-machine-runtime";

const safeIri = (value: string) => /^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(value) && value.length <= 4096;
const iri = (value: string) => { if (!safeIri(value)) throw new Error("Invalid status IRI."); return `<${value}>`; };

export function statusTransitionUpdate(input: {
  machine: CompiledStatusMachine;
  transition: StatusTransition;
  assertions: readonly string[];
  graph: string;
  resource: string;
  predicate: string;
}): string {
  const { machine, transition, assertions } = input;
  const track = machine.tracks.get(transition.dimension);
  if (!track || !track.states.has(transition.from) || !track.states.has(transition.to))
    throw new Error("RDF status transition has no matching track.");
  const g = iri(input.graph), subject = iri(input.resource), predicate = iri(input.predicate);
  const members = [...track.states].map(iri).join(", ");
  const storedFrom = assertions.includes(transition.from);
  const stillCurrent = storedFrom ? `BOUND(?old) && ?old = ${iri(transition.from)}` : "!BOUND(?old)";
  const insert = transition.add ? `GRAPH ${g} { ${subject} ${predicate} ${iri(transition.add)} }` : "";
  return `DELETE { GRAPH ${g} { ${subject} ${predicate} ?old } }
    INSERT { ${insert} }
    WHERE {
      OPTIONAL { GRAPH ${g} { ${subject} ${predicate} ?old . FILTER(?old IN (${members})) } }
      FILTER(${stillCurrent})
    }`;
}
