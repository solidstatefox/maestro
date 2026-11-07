/**
 * First Maestro View: a genuine XSLT 1.0 transformation of the graph-server
 * results supplied by the personal dataspace registry, scoped by the live FCT query.
 * XSLT 1.0 is intentionally used for native browser XSLTProcessor support.
 */
export type GraphServerViewEntry = {
  uri: string;
  label: string;
  group: string;
  status: "online" | "unavailable" | "unchecked";
  httpStatus: number | null;
};

export const GRAPH_SERVER_VIEW_XSLT = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" omit-xml-declaration="yes" encoding="UTF-8"/>
  <xsl:template match="/graphServers">
    <section class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Graph servers">
      <xsl:apply-templates select="server"/>
    </section>
  </xsl:template>
  <xsl:template match="server">
    <article class="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <span class="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xl" aria-hidden="true">&#x1F310;</span>
        <xsl:choose>
          <xsl:when test="@status = 'online'"><span class="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">HTTP 200</span></xsl:when>
          <xsl:when test="@status = 'unavailable'"><span class="rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800 dark:bg-orange-950 dark:text-orange-300"><xsl:text>HTTP </xsl:text><xsl:value-of select="@httpStatus"/></span></xsl:when>
          <xsl:otherwise><span class="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">Not checked</span></xsl:otherwise>
        </xsl:choose>
      </div>
      <div class="min-w-0 space-y-1">
        <h3 class="break-words text-base font-semibold"><xsl:value-of select="@label"/></h3>
        <p class="text-xs text-muted-foreground"><xsl:value-of select="@group"/></p>
      </div>
      <a class="break-all text-sm text-primary underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">
        <xsl:attribute name="href"><xsl:value-of select="@uri"/></xsl:attribute>
        <xsl:value-of select="@uri"/>
      </a>
      <p class="mt-auto border-t pt-3 text-xs text-muted-foreground">Graph server registered in your personal dataspace</p>
    </article>
  </xsl:template>
</xsl:stylesheet>`;

export function renderGraphServerXslt(servers: GraphServerViewEntry[]): string {
  if (typeof DOMParser === "undefined" || typeof XSLTProcessor === "undefined") {
    throw new Error("This browser does not support the XSLTProcessor required for Graph Servers View.");
  }
  const input = document.implementation.createDocument(null, "graphServers");
  const root = input.documentElement;
  for (const server of servers) {
    // Generated markup never includes arbitrary schemes, script attributes or HTML.
    // XML attributes are written via DOM APIs and XSLT uses value-of (escaped text).
    let uri: URL;
    try { uri = new URL(server.uri); } catch { continue; }
    if (uri.protocol !== "http:" && uri.protocol !== "https:") continue;
    const element = input.createElement("server");
    element.setAttribute("uri", uri.href);
    element.setAttribute("label", server.label);
    element.setAttribute("group", server.group);
    element.setAttribute("status", server.status);
    element.setAttribute("httpStatus", server.httpStatus === null ? "Unknown" : String(server.httpStatus));
    root.appendChild(element);
  }
  const stylesheet = new DOMParser().parseFromString(GRAPH_SERVER_VIEW_XSLT, "application/xml");
  if (stylesheet.querySelector("parsererror")) throw new Error("Graph Servers XSLT is not well-formed XML.");
  const processor = new XSLTProcessor();
  processor.importStylesheet(stylesheet);
  const fragment = processor.transformToFragment(input, document);
  const output = document.createElement("div");
  output.appendChild(fragment);
  return output.innerHTML;
}
