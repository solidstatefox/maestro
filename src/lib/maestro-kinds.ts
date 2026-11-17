/** Native Kind identifiers and filters. Provider regexes come from RDF over
 * SPARQL, cached only within an authenticated browser session. No generated
 * /graph JSON registry or host-side provider snapshot is loaded. */

export type MaestroKind = "web-url" | "text" | "numeric" | "date" | "email" | "phone" | "anynomous";
export const MAESTRO_KINDS_PROVIDER = "gttp://ggg.maestro.ecosys/shacl/provider/kinds";
export const MAESTRO_KIND_IDS: readonly MaestroKind[] = ["web-url", "text", "numeric", "date", "email", "phone", "anynomous"];
export type KindDefinition = { id: MaestroKind; label: string; scope: string; pattern: string; datatypes: readonly string[] };
const XSD = "http://www.w3.org/2001/XMLSchema#";
const datatypeNames: Record<MaestroKind, readonly string[]> = {
  "web-url":[], text:[], numeric:["integer","decimal","float","double","int","long","short","byte","nonNegativeInteger","positiveInteger","unsignedInt","unsignedLong","unsignedShort","unsignedByte"],
  date:["date","dateTime","time","gYear","gYearMonth"], email:[],phone:[],anynomous:[],
};
const scopes: Record<MaestroKind,string> = {
  "web-url":"resource-or-literal",text:"literal-except-other-kinds",numeric:"literal",date:"literal",email:"any",phone:"any",anynomous:"blank",
};
const patterns = new Map<MaestroKind,string>();
let patternVersion = 0;
const patternListeners = new Set<() => void>();
export function getMaestroKindsRevision(): number { return patternVersion; }
export function subscribeMaestroKinds(listener: () => void): () => void {
  patternListeners.add(listener);
  return () => { patternListeners.delete(listener); };
}
function publishKindsRevision() {
  ++patternVersion;
  for (const listener of patternListeners) listener();
}
export const MAESTRO_KINDS: ReadonlyArray<KindDefinition> = MAESTRO_KIND_IDS.map(id=>({
  id,label:id,scope:scopes[id],
  get pattern() { return patterns.get(id) ?? ""; },
  datatypes:datatypeNames[id],
}));
export function hydrateMaestroKinds(source: ReadonlyArray<{id:string;pattern:string}>) {
  // Multiple RDF providers can declare a regex for the same native Kind. Keep
  // each provider contribution, combining alternatives without a special
  // build-time registry or redefining Maestro's Kind semantics.
  const contributions = new Map<MaestroKind, Set<string>>();
  for (const row of source) {
    const kind = normalizeMaestroKind(row.id);
    if (!kind || kind === "text" || kind === "anynomous" || !row.pattern || row.pattern.length > 512) continue;
    new RegExp(row.pattern, "i");
    const alternatives = contributions.get(kind) ?? new Set<string>();
    alternatives.add(row.pattern);
    contributions.set(kind, alternatives);
  }
  if (!contributions.size) throw new Error("No usable Kind regexes found in personal RDF providers.");
  const next = new Map<MaestroKind, string>();
  for (const [kind, alternatives] of contributions) {
    const combined = [...alternatives].map(pattern => `(?:${pattern})`).join("|");
    if (combined.length > 4096) throw new Error(`Too many regex alternatives for ${kind}.`);
    next.set(kind, combined);
  }
  if (MAESTRO_KIND_IDS.every(kind => patterns.get(kind) === next.get(kind))) return;
  patterns.clear();
  for (const [kind, pattern] of next) patterns.set(kind, pattern);
  publishKindsRevision();
}
export function clearMaestroKinds(){if(patterns.size){patterns.clear();publishKindsRevision();}}
export function normalizeMaestroKind(raw:string):MaestroKind|null {
  const kind=raw==="string"?"text":raw==="anonymous"?"anynomous":raw;
  return MAESTRO_KIND_IDS.includes(kind as MaestroKind)?kind as MaestroKind:null;
}
function quote(text:string){return JSON.stringify(text);}
export function maestroKindSparql(kindRaw:string,term:string):string|null {
  const kind=normalizeMaestroKind(kindRaw);
  if(!kind)return null;
  if(kind==="anynomous")return `isBlank(${term})`;
  const matches=(item:KindDefinition):string=>{
    const regex=item.pattern?`REGEX(STR(${term}), ${quote(item.pattern)}, "i")`:"false";
    const typed=item.datatypes.length?`DATATYPE(${term}) IN (${item.datatypes.map(d=>`<${XSD}${d}>`).join(", ")})`:"false";
    const test=item.datatypes.length?`(${typed} || ${regex})`:regex;
    return item.scope==="literal"?`(isLiteral(${term}) && ${test})`:
      item.scope==="resource-or-literal"?`((isIRI(${term}) || isLiteral(${term})) && ${test})`:test;
  };
  if(kind==="text")return `(isLiteral(${term}) && !(${MAESTRO_KINDS.filter(item=>!['text','anynomous'].includes(item.id)).map(matches).join(" || ")}))`;
  return matches(MAESTRO_KINDS.find(item=>item.id===kind)!);
}
export function classifyMaestroKind(value:string,termType:string,datatype=""):MaestroKind {
  if(termType==="bnode" || termType==="blank")return "anynomous";
  const literal=termType!=="uri", dt=datatype.replace(/^.*[#/]/,"");
  for(const item of MAESTRO_KINDS){
    if(item.id==="text" || item.id==="anynomous")continue;
    if(item.scope==="literal" && !literal)continue;
    if((item.datatypes.includes(dt)&&literal) || (item.pattern&&new RegExp(item.pattern,"i").test(value)))return item.id;
  }
  return "text";
}
