<?xml version="1.0" encoding="UTF-8"?>
<!-- Map provider transformation. Geographic semantics and RDF result parsing
     live here; Maestro's query bridge supplies standard SPARQL Results XML. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.w3.org/2005/sparql-results#" exclude-result-prefixes="s">
 <xsl:output method="xml" omit-xml-declaration="yes"/>
 <xsl:template match="/s:sparql">
  <points><xsl:apply-templates select="s:results/s:result"/></points>
 </xsl:template>
 <xsl:template match="s:result">
  <xsl:variable name="uri" select="string(s:binding[@name='c1']/s:uri)"/>
  <xsl:variable name="lat-field" select="string(s:binding[@name='lat']/*[1])"/>
  <xsl:variable name="lng-field" select="string(s:binding[@name='lng']/*[1])"/>
  <xsl:variable name="point" select="normalize-space(translate(string(s:binding[@name='point']/*[1]),',',' '))"/>
  <xsl:variable name="wkt" select="string(s:binding[@name='wkt']/*[1])"/>
  <xsl:variable name="inside" select="normalize-space(substring-before(substring-after($wkt,'('),')'))"/>
  <xsl:variable name="lat">
   <xsl:choose>
    <xsl:when test="$lat-field != '' and $lng-field != ''"><xsl:value-of select="$lat-field"/></xsl:when>
    <xsl:when test="$point != ''"><xsl:value-of select="substring-before(concat($point,' '),' ')"/></xsl:when>
    <xsl:when test="contains(concat(' ',translate($wkt,'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ')),' POINT') and contains($wkt,'(') and contains($wkt,')')"><xsl:value-of select="normalize-space(substring-after($inside,' '))"/></xsl:when>
   </xsl:choose>
  </xsl:variable>
  <xsl:variable name="lng">
   <xsl:choose>
    <xsl:when test="$lat-field != '' and $lng-field != ''"><xsl:value-of select="$lng-field"/></xsl:when>
    <xsl:when test="$point != ''"><xsl:value-of select="normalize-space(substring-after($point,' '))"/></xsl:when>
    <xsl:when test="contains(concat(' ',translate($wkt,'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ')),' POINT') and contains($wkt,'(') and contains($wkt,')')"><xsl:value-of select="substring-before(concat($inside,' '),' ')"/></xsl:when>
   </xsl:choose>
  </xsl:variable>
  <xsl:if test="$uri != '' and string($lat) != '' and string($lng) != '' and number($lat) = number($lat) and number($lng) = number($lng) and number($lat) &gt;= -90 and number($lat) &lt;= 90 and number($lng) &gt;= -180 and number($lng) &lt;= 180">
   <point uri="{$uri}" lat="{$lat}" lng="{$lng}">
    <xsl:attribute name="title"><xsl:choose><xsl:when test="s:binding[@name='title']/*[1]"><xsl:value-of select="s:binding[@name='title']/*[1]"/></xsl:when><xsl:otherwise><xsl:value-of select="$uri"/></xsl:otherwise></xsl:choose></xsl:attribute>
   </point>
  </xsl:if>
 </xsl:template>
</xsl:stylesheet>
