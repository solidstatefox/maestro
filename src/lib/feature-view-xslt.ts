/** XSLT 1.0 presentations for the three contextual feature registries.
 * Inputs are projection rows from the personal RDF store, never raw HTML. */
export type FeatureKind = "policies" | "formats" | "transcoders";
export type FeatureItem = { uri: string; label: string; description?: string; target?: string; detail?: string; author?: string; activation?: string };

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
  <xsl:template match="result"><article data-feature-uri="{@uri}" class="rounded-lg border bg-card p-4 space-y-2"><xsl:if test="string-length(@target) &gt; 0"><div class="w-full border-b border-border/50 bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground"><button type="button" data-feature-open-uri="{@target}" class="underline decoration-dotted hover:text-foreground" title="{@target}"><xsl:choose><xsl:when test="string-length(@targetLabel) &gt; 0"><xsl:value-of select="@targetLabel"/></xsl:when><xsl:otherwise><xsl:value-of select="@target"/></xsl:otherwise></xsl:choose></button></div></xsl:if>
    <div class="group flex items-center gap-2">
      <xsl:if test="@bookmarked = 'true'"><input type="checkbox" data-policy-action="toggle" aria-label="Approve policy"><xsl:if test="@status = 'Approved'"><xsl:attribute name="checked">checked</xsl:attribute></xsl:if></input></xsl:if>
      <h3 class="font-medium min-w-0"><button type="button" data-feature-open-uri="{@uri}" class="text-left underline decoration-dotted hover:text-foreground" title="{@uri}"><xsl:value-of select="@label"/></button></h3>
      <span class="ml-auto inline-flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button type="button" data-feature-code="true" class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="View policy code" title="View code"><span data-lucide-icon="code-2"></span></button>
        <xsl:if test="@bookmarked = 'true'"><button type="button" data-policy-action="forget" class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Forget discovered policy" title="Forget policy"><span data-lucide-icon="x"></span></button></xsl:if>
      </span>
    </div>
    <xsl:if test="string-length(@author) &gt; 0"><p class="text-xs text-muted-foreground">by <xsl:value-of select="@author"/></p></xsl:if>
    <xsl:if test="string-length(@description) &gt; 0"><p class="text-sm text-muted-foreground"><xsl:value-of select="@description"/></p></xsl:if>
    <xsl:if test="string-length(@activation) &gt; 0"><p class="text-sm text-muted-foreground"><xsl:value-of select="@activation"/></p></xsl:if>
    <xsl:if test="string-length(@target) &gt; 0"><p class="break-all text-xs text-muted-foreground">Target class: <button type="button" data-feature-open-uri="{@target}" class="underline decoration-dotted hover:text-foreground" title="{@target}"><xsl:choose><xsl:when test="string-length(@targetLabel) &gt; 0"><xsl:value-of select="@targetLabel"/></xsl:when><xsl:otherwise><xsl:value-of select="@target"/></xsl:otherwise></xsl:choose></button></p></xsl:if>
    <xsl:if test="string-length(@detail) &gt; 0"><p class="break-all text-xs text-muted-foreground">Shape: <button type="button" data-feature-open-uri="{@detail}" class="underline decoration-dotted hover:text-foreground" title="{@detail}"><xsl:choose><xsl:when test="string-length(@detailLabel) &gt; 0"><xsl:value-of select="@detailLabel"/></xsl:when><xsl:otherwise><xsl:value-of select="@detail"/></xsl:otherwise></xsl:choose></button></p></xsl:if>
    <xsl:if test="string-length(@lastRequestedBy) &gt; 0">
      <p class="break-all text-xs text-muted-foreground">Last requested by: <xsl:choose>
        <xsl:when test="string-length(@lastRequestedBy) &gt; 0"><xsl:call-template name="trigger-links"><xsl:with-param name="value" select="@lastRequestedBy"/></xsl:call-template></xsl:when>
        <xsl:otherwise><xsl:call-template name="trigger-links"><xsl:with-param name="value" select="@triggeredBy"/></xsl:call-template></xsl:otherwise>
      </xsl:choose>
      <xsl:if test="string-length(@lastRequestDate) &gt; 0"><span class="ml-2" title="Last request date"><xsl:value-of select="@lastRequestDate"/></span></xsl:if>
      </p>
    </xsl:if>
    <xsl:if test="string-length(@lastRequestHistory) &gt; 0"><p class="break-all text-xs text-muted-foreground">History context: <button type="button" data-feature-open-uri="{@lastRequestHistory}" title="{@lastRequestHistory}" class="underline decoration-dotted"><xsl:value-of select="@lastRequestHistory"/></button></p></xsl:if>
    <xsl:if test="string-length(@lastRequestComponent) &gt; 0"><p class="break-all text-xs text-muted-foreground">UI component: <button type="button" data-feature-open-uri="{@lastRequestComponent}" title="{@lastRequestComponent}" class="underline decoration-dotted"><xsl:value-of select="@lastRequestComponent"/></button></p></xsl:if>
    <xsl:if test="string-length(@matchedRecord) &gt; 0"><p class="break-all text-xs text-muted-foreground">Matched Record: <button type="button" data-feature-open-uri="{@matchedRecord}" title="{@matchedRecord}" class="underline decoration-dotted"><xsl:value-of select="@matchedRecord"/></button></p></xsl:if>
  </article></xsl:template>
<xsl:template name="trigger-links"><xsl:param name="value"/><xsl:variable name="first" select="normalize-space(substring-before(concat($value, ','), ','))"/><xsl:if test="string-length($first) &gt; 0"><button type="button" data-feature-open-uri="{$first}" title="{$first}" class="underline decoration-dotted hover:text-foreground"><xsl:call-template name="last-fragment"><xsl:with-param name="value" select="$first"/></xsl:call-template></button></xsl:if><xsl:if test="contains($value, ',')"><xsl:text>, </xsl:text><xsl:call-template name="trigger-links"><xsl:with-param name="value" select="substring-after($value, ',')"/></xsl:call-template></xsl:if></xsl:template>
<xsl:template name="last-fragment"><xsl:param name="value"/><xsl:choose><xsl:when test="contains($value, '/')"><xsl:call-template name="last-fragment"><xsl:with-param name="value" select="substring-after($value, '/')"/></xsl:call-template></xsl:when><xsl:otherwise><xsl:value-of select="$value"/></xsl:otherwise></xsl:choose></xsl:template>
</xsl:stylesheet>`,
  formats: `${common}
  <xsl:template match="/results">
    <section data-view-title="Formats" data-view-icon="layout-grid" class="space-y-1" aria-label="Applicable formats">
      <xsl:apply-templates select="result"/>
    </section>
  </xsl:template>
  <xsl:template match="result"><article data-feature-uri="{@uri}" class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-3 py-2 text-sm"><xsl:if test="string-length(@target) &gt; 0"><div class="w-full border-b border-border/50 bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground"><xsl:choose><xsl:when test="contains(@target, '#')"><xsl:call-template name="last-fragment"><xsl:with-param name="value" select="substring-after(@target, '#')"/></xsl:call-template></xsl:when><xsl:otherwise><xsl:call-template name="last-fragment"><xsl:with-param name="value" select="@target"/></xsl:call-template></xsl:otherwise></xsl:choose></div></xsl:if>
    <input type="checkbox" data-feature-select="true" aria-label="Select format"/><strong class="min-w-40"><xsl:value-of select="@label"/></strong>
    <xsl:if test="string-length(@detail) &gt; 0"><code class="text-xs text-muted-foreground"><xsl:value-of select="@detail"/></code></xsl:if>
    <xsl:if test="string-length(@target) &gt; 0"><span class="text-xs text-muted-foreground"><xsl:value-of select="@target"/></span></xsl:if>
    <xsl:if test="string-length(@description) &gt; 0"><p class="text-sm text-muted-foreground"><xsl:value-of select="@description"/></p></xsl:if>
    <xsl:if test="string-length(@activation) &gt; 0"><p class="text-sm text-muted-foreground"><xsl:value-of select="@activation"/></p></xsl:if>
    <xsl:if test="string-length(@author) &gt; 0"><p class="text-xs text-muted-foreground">Author: <xsl:value-of select="@author"/></p></xsl:if>
  <button type="button" data-feature-code="true" class="mt-2 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">Code</button>
  </article></xsl:template>
<xsl:template name="last-fragment"><xsl:param name="value"/><xsl:choose><xsl:when test="contains($value, '/')"><xsl:call-template name="last-fragment"><xsl:with-param name="value" select="substring-after($value, '/')"/></xsl:call-template></xsl:when><xsl:otherwise><xsl:value-of select="$value"/></xsl:otherwise></xsl:choose></xsl:template>
</xsl:stylesheet>`,
  transcoders: `${common}
  <xsl:template match="/results">
    <section data-view-title="Transcoders" data-view-icon="network" class="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Applicable transcoders">
      <xsl:apply-templates select="result"/>
    </section>
  </xsl:template>
  <xsl:template match="result"><article data-feature-uri="{@uri}" class="space-y-2 rounded-lg border bg-card p-4"><xsl:if test="string-length(@target) &gt; 0"><div class="w-full border-b border-border/50 bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground"><xsl:choose><xsl:when test="contains(@target, '#')"><xsl:call-template name="last-fragment"><xsl:with-param name="value" select="substring-after(@target, '#')"/></xsl:call-template></xsl:when><xsl:otherwise><xsl:call-template name="last-fragment"><xsl:with-param name="value" select="@target"/></xsl:call-template></xsl:otherwise></xsl:choose></div></xsl:if>
    <div class="flex items-center gap-2"><input type="checkbox" data-feature-select="true" aria-label="Select transcoder"/><h3 class="font-medium"><xsl:value-of select="@label"/></h3></div>
    <xsl:if test="string-length(@description) &gt; 0"><p class="text-sm text-muted-foreground"><xsl:value-of select="@description"/></p></xsl:if>
    <xsl:if test="string-length(@activation) &gt; 0"><p class="text-sm text-muted-foreground"><xsl:value-of select="@activation"/></p></xsl:if>
    <xsl:if test="string-length(@author) &gt; 0"><p class="text-xs text-muted-foreground">Author: <xsl:value-of select="@author"/></p></xsl:if>
    <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
      <span>Input: <xsl:value-of select="@target"/></span><span>Output: <xsl:value-of select="@detail"/></span>
    </div>
    <p class="break-all text-xs text-muted-foreground"><xsl:value-of select="@uri"/></p>
  <button type="button" data-feature-code="true" class="mt-2 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">Code</button>
  </article></xsl:template>
<xsl:template name="last-fragment"><xsl:param name="value"/><xsl:choose><xsl:when test="contains($value, '/')"><xsl:call-template name="last-fragment"><xsl:with-param name="value" select="substring-after($value, '/')"/></xsl:call-template></xsl:when><xsl:otherwise><xsl:value-of select="$value"/></xsl:otherwise></xsl:choose></xsl:template>
</xsl:stylesheet>`,
};
