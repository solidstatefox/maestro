/** Sandboxed XSLT 3.0 for SHACL-discovered service request/response transforms. */
import { saxonJsonToXml, transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const forbiddenFunctions = /\b(?:doc|doc-available|document|collection|uri-collection|unparsed-text(?:-lines|-available)?|json-doc|environment-variable|available-environment-variables|function-lookup|load-xquery-module|transform|resolve-uri|static-base-uri)\s*\(/i;
const forbiddenInstructions = new Set(["include", "import", "import-schema", "use-package", "result-document", "evaluate", "fork", "source-document", "stream", "package"]);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", preserveOrder: true, processEntities: false });

export async function executeServiceXslt(stylesheet: string, inputXml: string, recordUri: string): Promise<string> {
  if (stylesheet.length > 250000 || inputXml.length > 850000 || XMLValidator.validate(stylesheet) !== true || XMLValidator.validate(inputXml) !== true) {
    throw new Error("Invalid or oversized service XSLT input.");
  }
  if (!stylesheet.includes("http://www.w3.org/1999/XSL/Transform") || !/version=["']3\.0["']/.test(stylesheet)) {
    throw new Error("Service transforms must be XSLT 3.0.");
  }
  if (forbiddenFunctions.test(stylesheet) || /(?:http:\/\/saxon\.sf\.net\/|http:\/\/saxonica\.com|\b(?:java|javascript|ixsl):)/i.test(stylesheet)) {
    throw new Error("External XSLT functions and extensions are forbidden.");
  }
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith("xsl:") && forbiddenInstructions.has(key.slice(4))) throw new Error("Unsafe service XSLT instruction.");
      if (key.startsWith("@_") && forbiddenFunctions.test(String(child))) throw new Error("Unsafe service XSLT expression.");
      if (["script", "iframe", "object", "embed"].includes(key.toLowerCase())) throw new Error("Unsafe service output element.");
      walk(child);
    }
  };
  walk(parser.parse(stylesheet));
  const result = await transformWithMaestroSaxon(stylesheet, inputXml, { recordUri, outputLimit: 750000 });
  if (typeof result !== "string" || result.length > 750000) throw new Error("Invalid or oversized service transform result.");
  return result;
}

/** Normalize a JSON response into the XSLT 3.0 standard XML representation.
 *  Service-authored output templates receive fn:map/fn:array as XML nodes,
 *  not a JSON string or a proprietary JSON-to-RDF conversion.
 */
export async function serviceJsonToXml(json: string): Promise<string> {
  if (json.length > 400000) throw new Error("Service JSON response exceeds the size limit.");
  const xml = await saxonJsonToXml(json);
  if (typeof xml !== "string" || xml.length > 1500000 || XMLValidator.validate(xml) !== true) {
    throw new Error("Service JSON could not be converted to XML.");
  }
  return xml;
}
