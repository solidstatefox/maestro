<?xml version="1.0" encoding="UTF-8"?>
<!--
  EURIO Project -> Result metadata projection, read-only.

  Input: Maestro Record envelope (mctx:describe and mctx:query), recordUri.
  The live FCT tree is a detached snapshot; this stylesheet never mutates it.
  Preserve the original query root's graph/server, remove all existing scope
  filters and move the sole view to the `eurio:hasResult` path. The selected
  Project IRI is bound at the root. The scoped Result URIs can then be used as
  the subjects of two merge-values columns, eurio:title/eurio:doi.

  merge-values preserves all hasResult resources, including those without
  title and DOI. These are metadata columns, not population constraints.
  Existing Record enrichment appends their RDF triples before formatting.
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:fct="http://openlinksw.com/services/facets/1.0"
  xmlns:fctr="http://openlinksw.com/services/facets/1.0/"
  xmlns:mctx="gttp://ggg.maestro.ecosys/ns/xslt/context#"
  xmlns="http://openlinksw.com/services/facets/1.0"
  exclude-result-prefixes="xs fct fctr mctx">
  <xsl:output method="xml" omit-xml-declaration="yes" encoding="UTF-8"/>
  <xsl:param name="recordUri" as="xs:string" select="''"/>
  <xsl:variable name="eu" as="xs:string" select="'http://data.europa.eu/s66#'"/>
  <xsl:variable name="projectRows" select="/mctx:context/mctx:describe/fctr:facets/fctr:result[@type='describe']/fctr:row[normalize-space(string(fctr:column[1])) = $recordUri]"/>
  <xsl:variable name="isProject" as="xs:boolean"
    select="exists($projectRows[fctr:column[2] = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' and fctr:column[3] = concat($eu,'Project')])"/>
  <xsl:variable name="hasResults" as="xs:boolean"
    select="exists($projectRows[fctr:column[2] = concat($eu,'hasResult') and fctr:column[3][@datatype='uri' or @termType='uri' or matches(string(.),'^https?://')]])"/>

  <xsl:template match="/">
    <xsl:apply-templates select="/mctx:context/mctx:query/fct:query" mode="project-results"/>
  </xsl:template>

  <xsl:template match="fct:query" mode="project-results">
    <xsl:copy>
      <xsl:copy-of select="@*"/>
      <!-- For non-Project Records, the absence of a view makes the generic
           enrichment host decline the network request. -->
      <xsl:if test="$isProject and $hasResults and matches($recordUri, '^https?://[^\s&lt;&gt;]+$')">
        <value datatype="uri"><xsl:value-of select="$recordUri"/></value>
        <property id="eu-results-path" iri="http://data.europa.eu/s66#hasResult">
          <view id="eu-results-view" type="merge-values" limit="100" offset="0"/>
          <property id="eu-result-title-projection" iri="http://data.europa.eu/s66#title"/>
          <property id="eu-result-doi-projection" iri="http://data.europa.eu/s66#doi"/>
        </property>
      </xsl:if>
    </xsl:copy>
  </xsl:template>
</xsl:stylesheet>
