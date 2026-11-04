import { NextResponse } from "next/server";
import { XMLValidator, XMLParser } from "fast-xml-parser";
import SaxonJS from "saxon-js";
import { requirePersonalLogin } from "@/lib/personal-guard";
// SaxonJS 2.7 exposes dynamic XSLT 3.0 execution through XPath fn:transform().
// This path runs entirely in the current Node.js process: no xslt3 executable,
// child process, or temporary filesystem output is required.
const DYNAMIC_TRANSFORM_XPATH = `
  transform(map {
    'stylesheet-text': $stylesheet,
    'source-node': parse-xml($source),
    'stylesheet-params': map { QName('', 'recordUri'): $recordUri },
    'delivery-format': 'serialized'
  })?output
`;

function transformStylesheet(xslt: string, sourceXml: string, recordUri: string): string {
  const output = SaxonJS.XPath.evaluate(DYNAMIC_TRANSFORM_XPATH, null, {
    params: { stylesheet: xslt, source: sourceXml, recordUri },
  });
  if (typeof output !== "string") {
    throw new Error("The XSLT output was invalid or too large.");
  }
  return output;
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
    // fn:transform compiles and executes the supplied stylesheet in-process.
    // SaxonJS 2.7 does not expose a stable public compile-to-SEF API.
    const html = transformStylesheet(stylesheetText, sourceXml, recordUri);
    if (typeof html !== "string" || html.length > 1000000) throw new Error("The XSLT output was invalid or too large.");
    return NextResponse.json({ html }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Compiler/transform failures can contain internal server paths and stacks.
    // Never return raw engine diagnostics to browser clients.
    console.error("Record XSLT transformation failed:", error);
    const safeMessage = error instanceof Error && /^(Invalid |Expected |Record templates |Saxon extension |XSLT instruction |External-|External document|Missing the XSLT namespace|The XSLT output |Executable HTML)/.test(error.message)
      ? error.message
      : "Record format could not be generated. Choose Default format or review the server logs.";
    return NextResponse.json({ error: safeMessage }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
