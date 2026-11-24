/** Inspect SPARQL Update graph targets without confusing embedded SPARQL source
 * code (e.g. the FCT query saved as an rdf:value literal) with an update clause.
 * No client-supplied graph can bypass the namespace checks in /proxy/api/sparql.
 */
export function inspectPersonalUpdateGraphs(update: string): {
  graphs: string[];
  hasImplicitGraph: boolean;
  clean: string;
  structure: string;
} {
  // Preserve character offsets so GRAPH keywords found outside IRI/literal
  // tokens can be matched against their corresponding explicit graph IRIs.
  const withoutStrings = update.split("");
  const outsideTokens = update.split("");
  const structure = update.split("");
  const blank = (from: number, to: number, iri = false, comment = false) => {
    for (let p = from; p < to; p++) {
      outsideTokens[p] = " ";
      structure[p] = comment ? " " : (p===from ? (iri ? "@" : "~") : " ");
      if (!iri) withoutStrings[p] = " ";
    }
  };
  for (let i = 0; i < update.length;) {
    const c = update[i];
    if (c === "<") {
      // A valid SPARQL IRIREF cannot contain whitespace or an unescaped '>'.
      const end = update.indexOf(">", i + 1);
      if (end > i && !/[\s<>"{}|^`\\]/.test(update.slice(i + 1, end))) {
        blank(i, end + 1, true);
        i = end + 1;
        continue;
      }
    }
    if (c === "#") {
      let end = update.indexOf("\n", i);
      if (end < 0) end = update.length;
      blank(i, end,false,true);
      i = end;
      continue;
    }
    if (c === "'" || c === '"') {
      const triple = update.slice(i, i + 3) === c.repeat(3);
      const delimiterLength = triple ? 3 : 1;
      let p = i + delimiterLength;
      let closed = false;
      while (p < update.length) {
        if (update[p] === "\\") { p += 2; continue; }
        if (update.slice(p, p + delimiterLength) === c.repeat(delimiterLength)) {
          p += delimiterLength;
          closed = true;
          break;
        }
        p++;
      }
      // An unterminated string is invalid syntax. Leave no possible update
      // clauses exposed after the initial quote.
      blank(i, closed ? p : update.length);
      i = closed ? p : update.length;
      continue;
    }
    i++;
  }
  const outside = outsideTokens.join("");
  const visible = withoutStrings.join("");
  const graphs: string[] = [];
  let hasImplicitGraph = false;
  for (const match of outside.matchAll(/\bGRAPH\b/gi)) {
    const offset = match.index ?? 0;
    const explicit = /^GRAPH\s*<([^<>]+)>/i.exec(visible.slice(offset));
    if (!explicit) {
      hasImplicitGraph = true;
    } else {
      graphs.push(explicit[1]);
    }
  }
  return { graphs, hasImplicitGraph, clean: outside, structure:structure.join("") };
}

/** Maestro emits explicit GRAPH templates, not default-graph updates or arbitrary
 * multi-operation programs. WHERE may contain OPTIONAL/VALUES/FILTER groups. */
export function hasExplicitPersonalUpdateTemplates(structure:string):boolean {
  const text=structure.trim();
  if(/^CLEAR\s+(?:SILENT\s+)?GRAPH\s+@\s*$/i.test(text))return true;
  let cursor=0;
  const skip=()=>{while(cursor<text.length && /\s/.test(text[cursor]))cursor++;};
  const consume=(pattern:RegExp)=>{skip();const hit=pattern.exec(text.slice(cursor));if(!hit)return false;cursor+=hit[0].length;return true;};
  const group=()=>{
    if(!consume(/^\{/))return false;
    let depth=1;
    while(cursor<text.length && depth){const c=text[cursor++];if(c==="{")depth++;else if(c==="}")depth--;}
    return depth===0;
  };
  const template=()=>{
    if(!consume(/^\{/))return false;
    while(true){
      if(consume(/^\}/))return true;
      if(!consume(/^GRAPH\s+@/i) || !group())return false;
      consume(/^\./);
    }
  };
  const first=consume(/^(?:INSERT|DELETE)\b/i);
  if(!first)return false;
  const deleteWhere=consume(/^WHERE\b/i);
  const data=!deleteWhere && consume(/^DATA\b/i);
  if(!template())return false;
  if(!deleteWhere && !data){
    if(consume(/^INSERT\b/i) && !template())return false;
    if(!consume(/^WHERE\b/i) || !group())return false;
  }
  skip();return cursor===text.length;
}
