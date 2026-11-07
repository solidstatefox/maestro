/** XSLT 1.0 presentations for the three contextual feature registries.
 * Inputs are projection rows from the personal RDF store, never raw HTML. */
export type FeatureKind = "policies" | "formats" | "transcoders";
export type FeatureItem = { uri: string; label: string; description?: string; target?: string; detail?: string };

const common = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" omit-xml-declaration="yes"/>`;

export const FEATURE_VIEW_XSLT: Record<FeatureKind, string> = {
  policies: `${common}
  <xsl:template match="/results">
    <section data-view-title="Policies" data-view-icon="network" class="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Applicable policies">
      <xsl:apply-templates select="result"/>
    </section>
  </xsl:template>
  <xsl:template match="result"><article class="rounded-lg border bg-card p-4 space-y-2">
    <h3 class="font-medium"><xsl:value-of select="@label"/></h3>
    <xsl:if test="string-length(@description) &gt; 0"><p class="text-sm text-muted-foreground"><xsl:value-of select="@description"/></p></xsl:if>
    <xsl:if test="string-length(@target) &gt; 0"><p class="break-all text-xs text-muted-foreground">Target class: <xsl:value-of select="@target"/></p></xsl:if>
    <xsl:if test="string-length(@detail) &gt; 0"><p class="break-all text-xs text-muted-foreground">Shape: <xsl:value-of select="@detail"/></p></xsl:if>
    <p class="break-all text-xs text-muted-foreground"><xsl:value-of select="@uri"/></p>
  </article></xsl:template>
</xsl:stylesheet>`,
  formats: `${common}
  <xsl:template match="/results">
    <section data-view-title="Formats" data-view-icon="layout-grid" class="space-y-1" aria-label="Applicable formats">
      <xsl:apply-templates select="result"/>
    </section>
  </xsl:template>
  <xsl:template match="result"><article class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-3 py-2 text-sm">
    <strong class="min-w-40"><xsl:value-of select="@label"/></strong>
    <xsl:if test="string-length(@detail) &gt; 0"><code class="text-xs text-muted-foreground"><xsl:value-of select="@detail"/></code></xsl:if>
    <xsl:if test="string-length(@target) &gt; 0"><span class="text-xs text-muted-foreground"><xsl:value-of select="@target"/></span></xsl:if>
    <xsl:if test="string-length(@description) &gt; 0"><p class="text-sm text-muted-foreground"><xsl:value-of select="@description"/></p></xsl:if>
  </article></xsl:template>
</xsl:stylesheet>`,
  transcoders: `${common}
  <xsl:template match="/results">
    <section data-view-title="Transcoders" data-view-icon="network" class="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Applicable transcoders">
      <xsl:apply-templates select="result"/>
    </section>
  </xsl:template>
  <xsl:template match="result"><article class="space-y-2 rounded-lg border bg-card p-4">
    <h3 class="font-medium"><xsl:value-of select="@label"/></h3>
    <xsl:if test="string-length(@description) &gt; 0"><p class="text-sm text-muted-foreground"><xsl:value-of select="@description"/></p></xsl:if>
    <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
      <span>Input: <xsl:value-of select="@target"/></span><span>Output: <xsl:value-of select="@detail"/></span>
    </div>
    <p class="break-all text-xs text-muted-foreground"><xsl:value-of select="@uri"/></p>
  </article></xsl:template>
</xsl:stylesheet>`,
};
