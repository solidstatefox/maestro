from pathlib import Path
r=Path('/mnt/data/maestro-pending-work')
p=r/'src/lib/feature-view-xslt.ts';s=p.read_text()
needle='"kinds" | "perspectives";';assert needle in s
s=s.replace(needle,'"kinds" | "perspectives" | "analysis-providers";')
# Insert provider view template near "fsm-providers"; use same standard approval action as Facets.
needle='''  "fsm-providers": `${common}''';assert needle in s
addition='''  "analysis-providers": `${common}
  <xsl:template match="/results"><section data-view-title="Analysis Providers" data-view-icon="chart-no-axes-combined" class="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Analyze provider approval"><xsl:apply-templates select="result"/></section></xsl:template>
  <xsl:template match="result"><article data-feature-uri="{@uri}" class="rounded-lg border bg-card p-4 space-y-2">
    <div class="flex items-center gap-2"><xsl:if test="string-length(@status) &gt; 0"><input type="checkbox" data-policy-action="toggle" aria-label="Approve Analysis provider"><xsl:if test="@status = 'Approved'"><xsl:attribute name="checked">checked</xsl:attribute></xsl:if></input></xsl:if><h3 class="font-medium"><xsl:value-of select="@label"/></h3></div>
    <xsl:if test="string-length(@description) &gt; 0"><p class="text-sm text-muted-foreground"><xsl:value-of select="@description"/></p></xsl:if>
    <xsl:if test="string-length(@activation) &gt; 0"><p class="text-xs text-muted-foreground"><xsl:value-of select="@activation"/></p></xsl:if>
    <p class="break-all text-xs text-muted-foreground"><xsl:value-of select="@uri"/></p>
    <button type="button" data-feature-code="true" class="rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent">Code</button>
  </article></xsl:template></xsl:stylesheet>`,
'''
s=s.replace(needle,addition+needle)
p.write_text(s)

p=r/'src/lib/feature-fct-query.ts';s=p.read_text();needle='''  } else if (feature === "fsm-providers") {''';assert needle in s
s=s.replace(needle,'''  } else if (feature === "analysis-providers") {
    // The provider is the result, not its widget. Spider and the bookmark
    // Analyze tools are ma:Analysis + mui:Provider in the policies graph.
    // Ordinary ma:Analysis resources without mui:Provider are not approvable.
    children = [node("feature-analysis-provider", "class", `${MUI}Provider`),
      node("feature-analysis-type", "class", "gttp://ggg.maestro.ecosys/ns/analyze#Analysis"), view];
'''+needle)
needle='''  if (feature === "fsm-providers") return hasClass(children, `${MUI}StateMachineProvider`);''';assert needle in s
s=s.replace(needle,'''  if (feature === "analysis-providers") return hasClass(children, `${MUI}Provider`) &&
    hasClass(children, "gttp://ggg.maestro.ecosys/ns/analyze#Analysis");
'''+needle)
p.write_text(s)

p=r/'src/lib/feature-catalog.ts';s=p.read_text();needle='''  if (feature === "perspectives") return "Activation: an approved PerspectiveWidget provider must match the current query scope.";''';assert needle in s
s=s.replace(needle,needle+'''
  if (feature === "analysis-providers") return "Activation: this RDF-declared Analysis provider must be approved before use in Analyze.";''')
p.write_text(s)

p=r/'src/canvas/tab/view/view-components.tsx';s=p.read_text();needle='''perspectives: "perspective provider",''';assert needle in s
s=s.replace(needle,'''perspectives: "perspective provider", "analysis-providers": "Analysis provider",''')
p.write_text(s)

p=r/'src/canvas/tab/view/ribbon.tsx';s=p.read_text();needle='''              { id: "perspectives", label: "Perspectives", Icon: Telescope },''';assert needle in s
s=s.replace(needle,needle+'''
              { id: "analysis-providers", label: "Analysis", Icon: ChartNoAxesCombined },''')
p.write_text(s)

p=r/'src/canvas/utils/workspace-controller.tsx';s=p.read_text();needle='''restored.viewFeature === "perspectives") setViewFeature(restored.viewFeature);''';assert needle in s
s=s.replace(needle,'''restored.viewFeature === "perspectives" || restored.viewFeature === "analysis-providers") setViewFeature(restored.viewFeature);''')
p.write_text(s)
print('Added View > Features > Analysis via FCT, XSLT, approval actions, and URL restoration')
