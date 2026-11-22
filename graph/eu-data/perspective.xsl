<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0">
<xsl:output method="html" omit-xml-declaration="yes" encoding="UTF-8"/>
<xsl:template match="/results">
<section data-view-title="EU Data Explorer" data-view-icon="database" class="mx-auto flex w-full max-w-5xl flex-col gap-5 p-3 text-foreground sm:p-5">
  <header class="flex flex-col gap-3 border-b border-border pb-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs font-semibold uppercase tracking-wide text-primary">European research and open data</p>
      <span class="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">Selected graph server</span>
    </div>
    <h2 class="text-2xl font-semibold tracking-tight">EU Data Explorer</h2>
    <p class="max-w-3xl text-sm leading-relaxed text-muted-foreground">Explore the current Maestro result population, using EURIO for CORDIS research information or DCAT-AP for open-data catalogues. Results are from the one graph server selected in Browse.</p>
    <div class="flex flex-wrap gap-2">
      <span class="rounded-lg border border-border bg-card px-3 py-2 text-sm"><strong class="font-semibold tabular-nums"><xsl:value-of select="count(result)"/></strong><span class="ml-2 text-muted-foreground">resources on this page</span></span>
      <span class="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">Single-source · No federation</span>
    </div>
  </header>
  <section class="space-y-3" aria-label="EU resources">
    <div class="flex flex-wrap items-baseline justify-between gap-2"><h3 class="text-base font-semibold">Resources</h3><p class="text-xs text-muted-foreground">Open a Record to inspect metadata, funding, participants, access and relationships.</p></div>
    <xsl:choose>
      <xsl:when test="not(result)"><p class="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No resources in the current result page. Adjust the Browse filters or pagination.</p></xsl:when>
      <xsl:otherwise>
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <xsl:for-each select="result">
            <article class="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
              <div class="flex items-center justify-between gap-3"><span class="text-xs font-medium text-muted-foreground">RDF resource</span><span class="rounded border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">Record</span></div>
              <button type="button" data-provider-open-uri="{@uri}" class="min-w-0 cursor-pointer break-words text-left text-base font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><xsl:choose><xsl:when test="normalize-space(@label)"><xsl:value-of select="@label"/></xsl:when><xsl:otherwise><xsl:value-of select="@uri"/></xsl:otherwise></xsl:choose></button>
              <p class="min-w-0 break-all text-xs text-muted-foreground"><xsl:value-of select="@uri"/></p>
              <xsl:if test="normalize-space(@description)"><p class="text-sm leading-relaxed text-muted-foreground"><xsl:value-of select="@description"/></p></xsl:if>
              <xsl:if test="normalize-space(@tags)"><p class="text-xs text-muted-foreground"><strong>Tags</strong><span class="ml-2"><xsl:value-of select="@tags"/></span></p></xsl:if>
            </article>
          </xsl:for-each>
        </div>
      </xsl:otherwise>
    </xsl:choose>
  </section>
  <footer class="border-t border-border pt-4 text-xs text-muted-foreground">Source and provenance remain attached to the selected graph server and the RDF identifiers. This Perspective does not join or infer identity between EURIO and DCAT-AP resources.</footer>
</section>
</xsl:template>
</xsl:stylesheet>
