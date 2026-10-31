import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDataserversGraph, updatePersonalSparql } from "./lib/personal-sparql";

type RdfTerm = { kind: "iri"; value: string } | { kind: "literal"; value: string; language?: string; datatype?: string };

function splitTurtleStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let inIri = false;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (inIri) { if (char === ">") inIri = false; continue; }
    if (char === '"') { inString = true; continue; }
    if (char === "<") { inIri = true; continue; }
    if (char === ".") {
      const statement = source.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function tokenize(statement: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < statement.length) {
    if (/\s/u.test(statement[i])) { i++; continue; }
    const start = i;
    if (statement[i] === "<") {
      i++;
      while (i < statement.length && statement[i] !== ">") i++;
      if (i >= statement.length) throw new Error("Unterminated IRI in dataserver Turtle seed.");
      i++;
      tokens.push(statement.slice(start, i));
      continue;
    }
    if (statement[i] === '"') {
      i++;
      let escaped = false;
      while (i < statement.length) {
        const char = statement[i++];
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') break;
      }
      if (statement[i] === "@") { i++; while (i < statement.length && /[A-Za-z0-9-]/u.test(statement[i])) i++; }
      else if (statement.slice(i, i + 2) === "^^") {
        i += 2;
        if (statement[i] === "<") { i++; while (i < statement.length && statement[i] !== ">") i++; if (i < statement.length) i++; }
        else while (i < statement.length && !/\s|[;,]/u.test(statement[i])) i++;
      }
      tokens.push(statement.slice(start, i));
      continue;
    }
    if ([";", ","].includes(statement[i])) { tokens.push(statement[i++]); continue; }
    while (i < statement.length && !/\s|[;,]/u.test(statement[i])) i++;
    tokens.push(statement.slice(start, i));
  }
  return tokens;
}

function parseSeedTurtle(source: string): string[] {
  const prefixes = new Map<string, string>();
  const triples: string[] = [];
  const expand = (token: string): RdfTerm => {
    if (token.startsWith("<") && token.endsWith(">")) return { kind: "iri", value: token.slice(1, -1) };
    if (token.startsWith('"')) {
      const langMatch = token.match(/^((?:"(?:\\.|[^"\\])*"))@([A-Za-z0-9-]+)$/u);
      const typedMatch = token.match(/^((?:"(?:\\.|[^"\\])*"))\^\^(.+)$/u);
      const lexical = JSON.parse((langMatch?.[1] ?? typedMatch?.[1] ?? token.split("^^", 1)[0])) as string;
      if (langMatch) return { kind: "literal", value: lexical, language: langMatch[2] };
      if (typedMatch) {
        const datatype = expand(typedMatch[2]);
        if (datatype.kind !== "iri") throw new Error("Invalid typed literal in dataserver seed.");
        return { kind: "literal", value: lexical, datatype: datatype.value };
      }
      return { kind: "literal", value: lexical };
    }
    const colon = token.indexOf(":");
    if (colon >= 0) {
      const prefix = token.slice(0, colon);
      const base = prefixes.get(prefix);
      if (base === undefined) throw new Error(`Unknown Turtle prefix '${prefix}' in dataserver seed.`);
      return { kind: "iri", value: base + token.slice(colon + 1) };
    }
    throw new Error(`Unsupported Turtle term '${token}' in dataserver seed.`);
  };
  const sparqlTerm = (term: RdfTerm) => term.kind === "iri"
    ? `<${term.value}>`
    : `${JSON.stringify(term.value)}${term.language ? `@${term.language}` : term.datatype ? `^^<${term.datatype}>` : ""}`;

  for (const statement of splitTurtleStatements(source)) {
    const prefixMatch = statement.match(/^@prefix\s+([A-Za-z][\w-]*):\s*<([^>]+)>\s*$/u);
    if (prefixMatch) { prefixes.set(prefixMatch[1], prefixMatch[2]); continue; }
    if (statement.startsWith("#")) continue;
    const tokens = tokenize(statement);
    if (tokens.length < 3) continue;
    const subject = expand(tokens[0]);
    if (subject.kind !== "iri") throw new Error("Expected an IRI subject in dataserver Turtle seed.");
    let index = 1;
    let predicate: RdfTerm | null = null;
    while (index < tokens.length) {
      const token = tokens[index++];
      if (token === ";") { predicate = null; continue; }
      if (token === ",") continue;
      if (!predicate) predicate = token === "a" ? { kind: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" } : expand(token);
      if (index >= tokens.length || tokens[index] === ";") continue;
      const object = expand(tokens[index++]);
      triples.push(`${sparqlTerm(subject)} ${sparqlTerm(predicate)} ${sparqlTerm(object)} .`);
      if (tokens[index] === ",") { index++; continue; }
      if (tokens[index] === ";") { index++; predicate = null; }
    }
  }
  return triples;
}

/** Rebuild the configured Datasites graph from the local SPARQL_ENDPOINTS Turtle file at server startup. */
export async function registerNode() {
  const seedPath = process.env.SPARQL_ENDPOINTS?.trim();
  if (!seedPath) {
    console.warn("Maestro startup: SPARQL_ENDPOINTS is unset; leaving the Datasites graph unchanged.");
    return;
  }
  try {
    const cwd = typeof process.cwd === "function" ? process.cwd() : ".";
    const targetFile = resolve(/*turbopackIgnore: true*/ cwd, seedPath);
    const source = await readFile(targetFile, "utf8");
    const uncommentedSource = source.split(/\r?\n/u).filter((line) => !line.trimStart().startsWith("#")).join("\n");
    const triples = parseSeedTurtle(uncommentedSource);
    if (!triples.length) throw new Error("The configured dataserver seed contains no RDF triples.");
    const dataserversGraph = getDataserversGraph();
    await updatePersonalSparql(`CLEAR SILENT GRAPH <${dataserversGraph}>`);
    const chunkSize = 100;
    for (let offset = 0; offset < triples.length; offset += chunkSize) {
      await updatePersonalSparql(`INSERT DATA { GRAPH <${dataserversGraph}> { ${triples.slice(offset, offset + chunkSize).join("\n")} } }`);
    }
    console.info(`Maestro startup: loaded ${triples.length} triples from ${seedPath} into ${dataserversGraph}.`);
  } catch (error) {
    console.error("Maestro startup could not rebuild the Datasites graph from SPARQL_ENDPOINTS.", error);
  }
}
