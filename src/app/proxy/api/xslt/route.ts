import { NextResponse } from "next/server";
import { XMLValidator, XMLParser } from "fast-xml-parser";
import SaxonJS from "saxon-js";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { join } from "node:path";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);
const compiledStylesheets = new Map<string, Promise<string>>();

async function compileStylesheet(xslt: string): Promise<string> {
  const key = createHash("sha256").update(xslt).digest("hex");
  const cached = compiledStylesheets.get(key);
  if (cached) return cached;
  const task = (async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "maestro-xslt-"));
    try {
      const source = path.join(directory, "record.xsl");
      const exportPath = path.join(directory, "record.sef.json");
      await writeFile(source, xslt, "utf8");
      // xslt3 ships with SaxonJS's own free XSLT 3.0 compiler.
const compiler = join(
  process.cwd(),
  "node_modules",
  "xslt3",
  "xslt3.js"
);

if (!existsSync(compiler)) {
  throw new Error(`SaxonJS XSLT compiler not found: ${compiler}`);
}
      await execFileAsync(process.execPath, [compiler, `-xsl:${source}`, `-export:${exportPath}`, "-nogo", "-ns:##html5"], {
        timeout: 20000,
        maxBuffer: 512 * 1024,
      });
      const sef = await readFile(exportPath, "utf8");
      if (sef.length > 3000000) throw new Error("Compiled stylesheet exceeds size limit.");
      return sef;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  })();
  compiledStylesheets.set(key, task);
  if (compiledStylesheets.size > 32) compiledStylesheets.delete(compiledStylesheets.keys().next().value!);
  task.catch(() => { if (compiledStylesheets.get(key) === task) compiledStylesheets.delete(key); });
  return task;
}


const XSL_NS = "http://www.w3.org/1999/XSL/Transform";
// Exclude mechanisms for opening network/filesystem resources, dynamic XPath,
// side-effecting Saxon/IXSL instructions, and importing other stylesheets.
// Pure XSLT 3.0 expressions (maps, arrays, grouping, iterate, functions,
// try/catch) remain available to template developers.
const PROHIBITED_XSL = new Set([
  "include", "import", "import-schema", "use-package", "result-document",
  "evaluate", "fork", "source-document", "stream", "package",
]);
const PROHIBITED_FUNCTIONS = /\b(?:doc|doc-available|document|collection|uri-collection|unparsed-text(?:-lines|-available)?|json-doc|environment-variable|available-environment-variables|function-lookup|load-xquery-module|transform|resolve-uri|static-base-uri)\s*\(/i;
const PROHIBITED_NAMESPACES = /(?:http:\/\/saxon\.sf\.net\/|http:\/\/saxonica\.com\/|http:\/\/saxonica\.com\/ns\/|http:\/\/saxonica\.com\/ns\/interactiveXSLT|http:\/\/www\.w3\.org\/1999\/XSL\/Transform\/java)/i;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", preserveOrder: true, processEntities: false });
type ParsedNode = Record<string, unknown>;

function validateTemplate(source: string): void {
  if (source.length > 250000 || XMLValidator.validate(source) !== true) throw new Error("Invalid or oversized XSLT stylesheet.");
  const nodes = parser.parse(source) as ParsedNode[];
  const root = nodes.find((node) => Object.keys(node).some((k) => /(?:^|:)stylesheet$|(?:^|:)transform$/.test(k)));
  if (!root || !/version="3\.0"/.test(source.slice(0, 1200))) throw new Error("Expected an XSLT 3.0 stylesheet.");
  if (PROHIBITED_NAMESPACES.test(source)) throw new Error("Saxon extension namespaces are not permitted in record templates.");
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    for (const [name, child] of Object.entries(value as ParsedNode)) {
      const localName = name.split(":").pop() ?? "";
      if ((name.startsWith("xsl:") || name === "xsl") && PROHIBITED_XSL.has(localName)) {
        throw new Error(`XSLT instruction ${name} is not permitted.`);
      }
      if (name.startsWith("@_") && (PROHIBITED_FUNCTIONS.test(String(child)) || /\b(?:java|javascript|ixsl):/i.test(String(child)))) {
        throw new Error("External-resource or extension calls are not permitted in record templates.");
      }
      if (["script", "iframe", "object", "embed"].includes(localName.toLowerCase())) throw new Error("Executable HTML is not permitted.");
      visit(child);
    }
  };
  visit(nodes);
  // Namespaces are not trusted to remain bound to these prefixes: reject
  // external-resource function syntax regardless of its surrounding context.
  if (PROHIBITED_FUNCTIONS.test(source)) throw new Error("External-document and dynamic-function calls are not permitted.");
  if (!source.includes(XSL_NS)) throw new Error("Missing the XSLT namespace.");
}

export async function POST(request: Request) {
  const loginRequired = requirePersonalLogin(request);
  if (loginRequired) return loginRequired;
  try {
    if (Number(request.headers.get("content-length") || 0) > 1200000) return NextResponse.json({ error: "XSLT request too large." }, { status: 413 });
    const body = await request.json() as { stylesheetText?: unknown; sourceXml?: unknown; recordUri?: unknown };
    const { stylesheetText, sourceXml, recordUri } = body;
    if (typeof stylesheetText !== "string" || typeof sourceXml !== "string" || typeof recordUri !== "string" || sourceXml.length > 850000 || recordUri.length > 4096) {
      return NextResponse.json({ error: "Invalid XSLT transformation parameters." }, { status: 400 });
    }
    validateTemplate(stylesheetText);
    if (XMLValidator.validate(sourceXml) !== true || !sourceXml.includes("mctx:context")) throw new Error("Invalid FCT context envelope.");
    const sef = await compileStylesheet(stylesheetText);
    const result = await SaxonJS.transform({
      stylesheetText: sef,
      sourceText: sourceXml,
      destination: "serialized",
      stylesheetParams: { recordUri },
    }, "async");
    const html = result.principalResult;
    if (typeof html !== "string" || html.length > 1000000) throw new Error("The XSLT output was invalid or too large.");
    return NextResponse.json({ html }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Subprocess failures can include local server paths, arguments and full Node.js stacks.
    // Never return raw compiler output to browser clients.
    console.error("Record XSLT transformation failed:", error);
    const missingAxios = error instanceof Error && /Cannot find module [\'\"]axios[\'\"]/.test(error.message);
    const safeMessage = missingAxios
      ? "The record format service is missing the axios runtime dependency. The server administrator must install it and redeploy; Default format is still available."
      : error instanceof Error && /^(Invalid |Expected |Record templates |Saxon extension |XSLT instruction |External-|External document|Missing the XSLT namespace|The XSLT output |Compiled stylesheet exceeds|Executable HTML)/.test(error.message)
        ? error.message
        : "Record format could not be generated. Check the server XSLT dependencies or choose Default format.";
    return NextResponse.json({ error: safeMessage }, { status: missingAxios ? 503 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
