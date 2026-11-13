<?xml version="1.0" encoding="UTF-8"?>
<!-- Provider-owned categorical palette. The source terms are RDF term keys,
     not display labels. Lexical sorting makes coloring stable across pagination. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
 <xsl:output method="xml" omit-xml-declaration="yes"/>
 <xsl:template match="/palette">
  <xsl:variable name="terms" select="term[@key != '' and not(@key = preceding-sibling::term/@key)]"/>
  <colors>
   <xsl:for-each select="$terms">
    <xsl:sort select="@key"/>
    <xsl:variable name="h" select="20 + (360 * (position() - 1) div count($terms))"/>
    <xsl:variable name="sector" select="($h mod 360) div 60"/>
    <xsl:variable name="diff" select="($sector mod 2) - 1"/>
    <xsl:variable name="absdiff"><xsl:choose><xsl:when test="$diff &lt; 0"><xsl:value-of select="-$diff"/></xsl:when><xsl:otherwise><xsl:value-of select="$diff"/></xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:variable name="c" select="(1 - (1 - 0.86)) * 0.76"/>
    <xsl:variable name="x" select="$c * (1 - number($absdiff))"/>
    <xsl:variable name="m" select="0.43 - $c div 2"/>
    <xsl:variable name="r"><xsl:choose><xsl:when test="$sector &lt; 1"><xsl:value-of select="$c"/></xsl:when><xsl:when test="$sector &lt; 2"><xsl:value-of select="$x"/></xsl:when><xsl:when test="$sector &lt; 4">0</xsl:when><xsl:when test="$sector &lt; 5"><xsl:value-of select="$x"/></xsl:when><xsl:otherwise><xsl:value-of select="$c"/></xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:variable name="g"><xsl:choose><xsl:when test="$sector &lt; 1"><xsl:value-of select="$x"/></xsl:when><xsl:when test="$sector &lt; 3"><xsl:value-of select="$c"/></xsl:when><xsl:when test="$sector &lt; 4"><xsl:value-of select="$x"/></xsl:when><xsl:otherwise>0</xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:variable name="b"><xsl:choose><xsl:when test="$sector &lt; 2">0</xsl:when><xsl:when test="$sector &lt; 3"><xsl:value-of select="$x"/></xsl:when><xsl:when test="$sector &lt; 5"><xsl:value-of select="$c"/></xsl:when><xsl:otherwise><xsl:value-of select="$x"/></xsl:otherwise></xsl:choose></xsl:variable>
    <color key="{@key}">
     <xsl:attribute name="hex">#<xsl:call-template name="hex2"><xsl:with-param name="v" select="round((number($r)+$m)*255)"/></xsl:call-template><xsl:call-template name="hex2"><xsl:with-param name="v" select="round((number($g)+$m)*255)"/></xsl:call-template><xsl:call-template name="hex2"><xsl:with-param name="v" select="round((number($b)+$m)*255)"/></xsl:call-template></xsl:attribute>
    </color>
   </xsl:for-each>
  </colors>
 </xsl:template>
 <xsl:template name="hex2">
  <xsl:param name="v"/>
  <xsl:variable name="hex" select="'0123456789abcdef'"/>
  <xsl:value-of select="substring($hex, floor($v div 16) + 1, 1)"/>
  <xsl:value-of select="substring($hex, ($v mod 16) + 1, 1)"/>
 </xsl:template>
</xsl:stylesheet>
