/** W3C RDF / SHACL-backed status machine adapter. XState v5 is the only
 * transition engine; this module does not prescribe state names or transitions.
 * Machine definitions are shared; assertions and snapshots are per resource. */
import { createMachine, getNextSnapshot } from "xstate";

export const STATUS_MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
export const STATUS_RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const SH = "http://www.w3.org/ns/shacl#";
export type StatusMachineRow = {
  machine: string;
  target: string;
  dimension: string;
  initial: string;
  from: string;
  trigger: string;
  to: string;
  digest?: string;
  /** RDF mui:assertState false means the destination is a virtual state. */
  assertState?: string;
};
export type CompiledStatusMachine = {
  uri: string;
  targetClasses: ReadonlySet<string>;
  digest: string;
  tracks: ReadonlyMap<string, { initial: string; states: ReadonlySet<string>; events: ReadonlyMap<string, ReadonlyMap<string, {to:string; assertState:boolean}>> }>;
  keys: ReadonlyMap<string,{region:string; byUri:ReadonlyMap<string,string>; byKey:ReadonlyMap<string,string>}>;
  engine: ReturnType<typeof createMachine>;
};
export type StatusTransition = {
  from: string;
  to: string;
  dimension: string;
  /** Empty means the initial state is effective rather than materialized. */
  remove: readonly string[];
  add: string | null;
};

/** Discover all machine definitions from the authenticated SHACL graph. An
 * RDF definition is authoritative; no version of this query encodes events. */
export function statusMachineSelect(shapesGraph: string): string {
  if (!/^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(shapesGraph)) throw new Error("Invalid SHACL graph URI.");
  return `PREFIX mui: <${STATUS_MUI}> PREFIX sh: <${SH}>
    SELECT DISTINCT ?machine ?target ?dimension ?initial ?from ?trigger ?to ?digest ?assertState WHERE {
      GRAPH <${shapesGraph}> {
        ?machine a mui:StateMachineProvider ; sh:targetClass ?target ; mui:statusTrack ?track .
        ?track mui:trackDimension ?dimension ; mui:initialState ?initial ; mui:transition ?transition .
        ?transition mui:fromState ?from ; mui:trigger ?trigger ; mui:toState ?to .
        OPTIONAL { ?machine mui:implementationDigest ?digest }
        OPTIONAL { ?transition mui:assertState ?assertState }
      }
    } LIMIT 2000`;
}

export function statusMachineRows(bindings: Array<Record<string, {value?: string}>>): StatusMachineRow[] {
  const needed = ["machine", "target", "dimension", "initial", "from", "trigger", "to"] as const;
  return bindings.map(binding => {
    for (const key of needed) if (!binding[key]?.value) throw new Error(`Invalid RDF state machine: ${key} is missing.`);
    return {
      machine: binding.machine.value!, target: binding.target.value!, dimension: binding.dimension.value!,
      initial: binding.initial.value!, from: binding.from.value!, trigger: binding.trigger.value!,
      to: binding.to.value!, digest: binding.digest?.value, assertState: binding.assertState?.value,
    };
  });
}

/** Cache compiled machines by the COMPLETE RDF definition (not just URI): a
 * changed definition can never continue executing an old transition graph. */
const compiledCache = new Map<string, CompiledStatusMachine[]>();
export function clearCompiledStatusMachines(): void { compiledCache.clear(); }

export function compileStatusMachines(rows: readonly StatusMachineRow[]): CompiledStatusMachine[] {
  const fingerprint = JSON.stringify([...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const cached = compiledCache.get(fingerprint);
  if (cached) return cached;
  const grouped = new Map<string, StatusMachineRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.machine) ?? [];
    group.push(row); grouped.set(row.machine, group);
  }
  if (!grouped.size) throw new Error("No mui:StateMachineProvider definitions were returned by the SHACL graph.");
  const compiled = [...grouped].map(([uri, definitions]) => {
    const targets = new Set(definitions.map(row=>row.target));
    const digests = new Set(definitions.map(row=>row.digest ?? ""));
    if (digests.size !== 1) throw new Error(`Conflicting RDF implementation digests for ${uri}`);
    const definitionsByTrack = new Map<string, StatusMachineRow[]>();
    for (const row of definitions) {
      const track = definitionsByTrack.get(row.dimension) ?? [];
      track.push(row); definitionsByTrack.set(row.dimension,track);
    }
    const tracks = new Map<string, {initial:string; states: Set<string>; events: Map<string, Map<string,{to:string;assertState:boolean}>>}>();
    // XState uses periods in target paths. RDF IRIs contain periods, so never
    // use raw IRIs as state node keys. Full URIs stay in the adapter metadata.
    const keys = new Map<string,{region:string;byUri:Map<string,string>;byKey:Map<string,string>}>();
    const states: Record<string, {initial:string;states:Record<string,{on:Record<string,string>}>}> = {};
    for (const [index,[dimension, definitions]] of [...definitionsByTrack].sort(([a],[b])=>a.localeCompare(b)).entries()) {
      const initials = new Set(definitions.map(row=>row.initial));
      if (initials.size !== 1) throw new Error(`Conflicting initial states for ${dimension}`);
      const initial = definitions[0].initial;
      const members = new Set([initial, ...definitions.flatMap(row=>[row.from,row.to])]);
      const byUri=new Map([...members].sort().map((item,position)=>[item,`s${position}`]));
      const byKey=new Map([...byUri].map(([key,value])=>[value,key]));
      const region=`track${index}`;
      keys.set(dimension,{region,byUri,byKey});
      const events = new Map<string, Map<string,{to:string;assertState:boolean}>>();
      const nested:Record<string,{on:Record<string,string>}> = {};
      for (const member of members) nested[byUri.get(member)!] = {on:{}};
      for (const row of definitions) {
        const transitions = events.get(row.from) ?? new Map<string,{to:string;assertState:boolean}>();
        if (row.assertState !== undefined && row.assertState !== "true" && row.assertState !== "false" && row.assertState !== "1" && row.assertState !== "0")
          throw new Error(`Invalid RDF mui:assertState: ${row.assertState}`);
        const assertState = row.assertState !== "false" && row.assertState !== "0";
        const previous = transitions.get(row.trigger);
        if (previous && (previous.to !== row.to || previous.assertState !== assertState))
          throw new Error(`Nondeterministic RDF transition: ${dimension}/${row.from}/${row.trigger}`);
        transitions.set(row.trigger,{to:row.to,assertState}); events.set(row.from,transitions);
        nested[byUri.get(row.from)!].on[row.trigger] = byUri.get(row.to)!;
      }
      tracks.set(dimension,{initial,states:members,events});
      states[region]={initial:byUri.get(initial)!,states:nested};
    }
    const engine = createMachine({id:uri,type:"parallel",states});
    return {uri,targetClasses:targets,digest:definitions[0].digest??"",tracks,keys,engine};
  });
  if (compiledCache.size > 12) compiledCache.clear();
  compiledCache.set(fingerprint,compiled);
  return compiled;
}

/** Explicit assertions are immutable input. Missing tracks use the RDF initial
 * state without creating a triple. Unknown statuses (e.g. unrelated dimensions)
 * pass through untouched. Ambiguous assertions are rejected, never guessed. */
export function effectiveStatus(machine: CompiledStatusMachine, assertions: readonly string[]): Record<string,string> {
  const values:Record<string,string> = {};
  for (const [dimension,track] of machine.tracks) {
    const explicit = [...new Set(assertions.filter(item=>track.states.has(item)))];
    if (explicit.length > 1) throw new Error(`Conflicting stored statuses for ${dimension}: ${explicit.join(", ")}`);
    values[dimension] = explicit[0] ?? track.initial;
  }
  return values;
}

/** Apply a trigger through XState's pure transition API, with no live actors.
 * This function does not execute SPARQL or mutate any resource. */
export function transitionStatus(machine:CompiledStatusMachine, assertions:readonly string[], trigger:string):StatusTransition {
  const values = effectiveStatus(machine,assertions);
  // Find the selected track by its current state's transition table. RDF
  // triggers are event URIs; ambiguous cross-track transitions are rejected.
  const matches = [...machine.tracks].filter(([dimension,track])=>track.events.get(values[dimension])?.has(trigger));
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous FSM trigger ${trigger}` : `FSM trigger ${trigger} is not allowed in the current state.`);
  const [dimension,track] = matches[0];
  const from=values[dimension];
  const encoded=Object.fromEntries(Object.entries(values).map(([dimension,uri])=>{
    const spec=machine.keys.get(dimension);
    if (!spec || !spec.byUri.has(uri))throw new Error(`Cannot encode RDF state ${uri}`);
    return [spec.region,spec.byUri.get(uri)!];
  }));
  const snapshot=machine.engine.resolveState({value:encoded});
  const next=getNextSnapshot(machine.engine,snapshot,{type:trigger});
  const resulting=next.value;
  if (!resulting || typeof resulting!=="object") throw new Error("Unexpected XState parallel snapshot.");
  const spec=machine.keys.get(dimension);
  const to=spec?.byKey.get((resulting as Record<string,string>)[spec.region]);
  if (typeof to!=="string" || to!==track.events.get(from)?.get(trigger)?.to)
    throw new Error("XState and RDF transition disagree.");
  // RDF controls persistence semantics too; no state names or dimensions are
  // hardcoded to select which transitions should write mui:status.
  const assertState=track.events.get(from)!.get(trigger)!.assertState;
  return {from,to,dimension,remove:[...track.states].filter(state=>assertions.includes(state)),add:assertState?to:null};
}

export function machineForTarget(machines:readonly CompiledStatusMachine[],target:string):CompiledStatusMachine {
  const matched=machines.filter(machine=>machine.targetClasses.has(target));
  if (matched.length!==1) throw new Error(`Expected exactly one RDF state machine targeting ${target}; found ${matched.length}.`);
  return matched[0];
}
