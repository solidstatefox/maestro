<?xml version="1.0" encoding="UTF-8"?>
<!-- The map provider's own FCT -> SPARQL query transform.
     Accepted paths are read from the actual mui:accepts SHACL shape triples,
     not copied into TypeScript or maintained as a second geographic vocabulary.
     The mui:mapBinding annotation on each SHACL property shape identifies the
     output variable populated by that constraint (lat/lng/point/wkt). -->
<xsl:stylesheet version="1.0"
 xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
 xmlns:mctx="gttp://ggg.maestro.ui/context"
 xmlns:s="http://www.w3.org/2005/sparql-results#"
 exclude-result-prefixes="mctx s">
 <xsl:output method="xml" omit-xml-declaration="yes"/>
 <xsl:key name="by-subject" match="s:result" use="s:binding[@name='s']/*[1]"/>
 <xsl:variable name="sh" select="'http://www.w3.org/ns/shacl#'"/>
 <xsl:variable name="rdf" select="'http://www.w3.org/1999/02/22-rdf-syntax-ns#'"/>
 <xsl:variable name="mui" select="'gttp://ggg.maestro.ecosys/ns/ui#'"/>
 <xsl:variable name="rdfs" select="'http://www.w3.org/2000/01/rdf-schema#'"/>

 <xsl:template match="/mctx:context">
  <xsl:variable name="focus" select="mctx:compiled/@target"/>
  <xsl:variable name="addr" select="mctx:query/*[local-name()='query']/@addr"/>
  <xsl:variable name="graph" select="substring-before($addr, '@')"/>
  <xsl:variable name="or-triple" select="(mctx:shape/s:sparql/s:results/s:result[s:binding[@name='p']/s:uri=concat($sh,'or')])[1]"/>
  <xsl:variable name="or-list" select="string($or-triple/s:binding[@name='o']/*[1])"/>
  <xsl:variable name="view" select="(mctx:query//*[local-name()='view'])[1]"/>
  <query-request timeout="{mctx:compiled/@timeout}" valid="{boolean($or-list != '' and count(mctx:shape/s:sparql/s:results/s:result[s:binding[@name='p']/s:uri=concat($rdf,'first')]) &gt; 0)}">
   <sparql>
    <xsl:value-of select="mctx:compiled/mctx:prefix"/>
    <xsl:text>SELECT DISTINCT </xsl:text><xsl:choose><xsl:when test="$focus = '?c1'"><xsl:text>?c1</xsl:text></xsl:when><xsl:otherwise><xsl:text>(</xsl:text><xsl:value-of select="$focus"/><xsl:text> AS ?c1)</xsl:text></xsl:otherwise></xsl:choose><xsl:text> ?lat ?lng ?point ?wkt ?title WHERE {&#10; { SELECT DISTINCT </xsl:text><xsl:value-of select="$focus"/>
    <xsl:text> WHERE {&#10;</xsl:text><xsl:value-of select="mctx:compiled/mctx:where"/><xsl:text>&#10;} }&#10;</xsl:text>
    <xsl:if test="contains($graph,':') and not(starts-with($graph,'$'))">
      <xsl:text>GRAPH &lt;</xsl:text><xsl:value-of select="$graph"/><xsl:text>&gt; {&#10;</xsl:text>
    </xsl:if>
    <xsl:text>{&#10;</xsl:text>
    <xsl:call-template name="alternatives">
      <xsl:with-param name="node" select="$or-list"/>
      <xsl:with-param name="focus" select="$focus"/>
      <xsl:with-param name="first" select="'true'"/>
    </xsl:call-template>
    <xsl:text>&#10;} OPTIONAL { </xsl:text><xsl:value-of select="$focus"/><xsl:text> &lt;</xsl:text><xsl:value-of select="concat($rdfs,'label')"/><xsl:text>&gt; ?title . }&#10;</xsl:text>
    <xsl:if test="contains($graph,':') and not(starts-with($graph,'$'))"><xsl:text>}&#10;</xsl:text></xsl:if>
    <xsl:text>} LIMIT 1000</xsl:text>
   </sparql>
   <facets>
    <xsl:for-each select="$view/../*[local-name()='property' or local-name()='property-of' or local-name()='class']">
     <xsl:variable name="direction">
      <xsl:choose><xsl:when test="local-name()='property-of'">reverse</xsl:when><xsl:when test="local-name()='class'">class</xsl:when><xsl:otherwise>forward</xsl:otherwise></xsl:choose>
     </xsl:variable>
     <facet id="{@id}" direction="{$direction}">
      <xsl:attribute name="iri"><xsl:choose><xsl:when test="local-name()='class'">http://www.w3.org/1999/02/22-rdf-syntax-ns#type</xsl:when><xsl:otherwise><xsl:value-of select="@iri"/></xsl:otherwise></xsl:choose></xsl:attribute>
     </facet>
    </xsl:for-each>
   </facets>
  </query-request>
 </xsl:template>

 <xsl:template name="alternatives">
  <xsl:param name="node"/><xsl:param name="focus"/><xsl:param name="first"/>
  <xsl:if test="$node != '' and $node != concat($rdf,'nil')">
   <xsl:variable name="first-triple" select="key('by-subject',$node)[s:binding[@name='p']/s:uri=concat($rdf,'first')]"/>
   <xsl:variable name="branch" select="string($first-triple/s:binding[@name='o']/*[1])"/>
   <xsl:variable name="next-triple" select="key('by-subject',$node)[s:binding[@name='p']/s:uri=concat($rdf,'rest')]"/>
   <xsl:variable name="next" select="string($next-triple/s:binding[@name='o']/*[1])"/>
   <xsl:if test="$first != 'true'"><xsl:text>&#10;UNION&#10;</xsl:text></xsl:if>
   <xsl:text>{&#10;</xsl:text>
   <xsl:for-each select="key('by-subject',$branch)[s:binding[@name='p']/s:uri=concat($sh,'property')]">
    <xsl:variable name="property" select="string(s:binding[@name='o']/*[1])"/>
    <xsl:variable name="binding" select="string(key('by-subject',$property)[s:binding[@name='p']/s:uri=concat($mui,'mapBinding')]/s:binding[@name='o']/*[1])"/>
    <xsl:variable name="path" select="key('by-subject',$property)[s:binding[@name='p']/s:uri=concat($sh,'path')]/s:binding[@name='o']/*[1]"/>
    <xsl:if test="string($path) != '' and ($binding='lat' or $binding='lng' or $binding='point' or $binding='wkt')">
     <xsl:value-of select="$focus"/><xsl:text> </xsl:text>
     <xsl:choose><xsl:when test="local-name($path)='uri'"><xsl:text>&lt;</xsl:text><xsl:value-of select="$path"/><xsl:text>&gt;</xsl:text></xsl:when>
      <xsl:otherwise><xsl:call-template name="sequence-path"><xsl:with-param name="node" select="string($path)"/></xsl:call-template></xsl:otherwise>
     </xsl:choose>
     <xsl:text> ?</xsl:text><xsl:value-of select="$binding"/><xsl:text> .&#10;</xsl:text>
    </xsl:if>
   </xsl:for-each>
   <xsl:text>}</xsl:text>
   <xsl:call-template name="alternatives"><xsl:with-param name="node" select="$next"/><xsl:with-param name="focus" select="$focus"/><xsl:with-param name="first" select="'false'"/></xsl:call-template>
  </xsl:if>
 </xsl:template>

 <xsl:template name="sequence-path">
  <xsl:param name="node"/>
  <xsl:variable name="first" select="key('by-subject',$node)[s:binding[@name='p']/s:uri=concat($rdf,'first')]"/>
  <xsl:variable name="rest" select="key('by-subject',$node)[s:binding[@name='p']/s:uri=concat($rdf,'rest')]"/>
  <xsl:if test="string($first/s:binding[@name='o']/*[1]) != ''">
   <xsl:text>&lt;</xsl:text><xsl:value-of select="$first/s:binding[@name='o']/*[1]"/><xsl:text>&gt;</xsl:text>
   <xsl:variable name="next" select="string($rest/s:binding[@name='o']/*[1])"/>
   <xsl:if test="$next != concat($rdf,'nil') and $next != ''">
    <xsl:text>/</xsl:text><xsl:call-template name="sequence-path"><xsl:with-param name="node" select="$next"/></xsl:call-template>
   </xsl:if>
  </xsl:if>
 </xsl:template>
</xsl:stylesheet>
