<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:mctx="gttp://ggg.maestro.ecosys/ns/xslt/context#" xmlns:fct="http://openlinksw.com/services/facets/1.0/" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:fmt="urn:maestro:eu-data:duration" version="3.0" exclude-result-prefixes="fct mctx xs fmt">
<xsl:output method="html" omit-xml-declaration="yes" encoding="UTF-8"/>
<!-- EURIO is a European vocabulary; use a dot for thousands and comma for decimals. -->
<xsl:decimal-format name="eu" decimal-separator="," grouping-separator="."/>
<!-- Human-readable month durations; fractional months are converted to approximate
     weeks/days using the mean Gregorian month (not a false exact date). -->
<xsl:function name="fmt:months" as="xs:string">
  <xsl:param name="raw" as="xs:string"/>
  <xsl:variable name="value" select="normalize-space($raw)"/>
  <xsl:choose>
    <xsl:when test="not(matches($value, '^[0-9]+([.][0-9]+)?$'))">
      <xsl:sequence select="if ($value != '') then $value else '—'"/>
    </xsl:when>
    <xsl:otherwise>
      <xsl:variable name="months" select="xs:decimal($value)"/>
      <xsl:variable name="whole" select="xs:integer(floor($months))"/>
      <xsl:variable name="years" select="$whole idiv 12"/>
      <xsl:variable name="remaining" select="$whole mod 12"/>
      <xsl:variable name="fractionDays" select="xs:integer(round(($months - $whole) * 30.436875))"/>
      <xsl:variable name="weeks" select="$fractionDays idiv 7"/>
      <xsl:variable name="days" select="$fractionDays mod 7"/>
      <xsl:variable name="parts" as="xs:string*" select="(
        if ($years gt 0) then concat($years, ' ', if ($years = 1) then 'year' else 'years') else (),
        if ($remaining gt 0) then concat($remaining, ' ', if ($remaining = 1) then 'month' else 'months') else (),
        if ($weeks gt 0) then concat($weeks, ' ', if ($weeks = 1) then 'week' else 'weeks') else (),
        if ($days gt 0) then concat($days, ' ', if ($days = 1) then 'day' else 'days') else ()
      )"/>
      <xsl:sequence select="concat(if (exists($parts)) then string-join($parts, ', ') else '0 months', if ($fractionDays gt 0) then ' (approx.)' else '')"/>
    </xsl:otherwise>
  </xsl:choose>
</xsl:function>

<!-- Presentation labels are an explicit EURIO Project domain decision, NOT
     the ontology's mechanically generated rdfs:labels. Keep predicate IRIs and
     all RDFa attributes unchanged; no ontology lookup is needed for display. -->
<xsl:function name="fmt:property-label" as="xs:string">
  <xsl:param name="iri" as="xs:string"/>
  <xsl:variable name="local" select="tokenize($iri,'[/#]')[last()]"/>
  <xsl:choose>
    <xsl:when test="$local=('hasTotalCost','totalCost')"><xsl:sequence select="'Cost'"/></xsl:when>
    <xsl:when test="$local='isFundedBy'"><xsl:sequence select="'Funded by'"/></xsl:when>
    <xsl:when test="$local='hasEuroSciVocClassification'"><xsl:sequence select="'Research fields'"/></xsl:when>
    <xsl:when test="$local='ecMaxContribution'"><xsl:sequence select="'EU contribution'"/></xsl:when>
    <xsl:when test="$local='fieldOfScience'"><xsl:sequence select="'Field of science'"/></xsl:when>
    <xsl:when test="$local='businessSector'"><xsl:sequence select="'Business sector'"/></xsl:when>
    <xsl:when test="$local='signatureDate'"><xsl:sequence select="'Signature date'"/></xsl:when>
    <xsl:when test="lower-case($local)='terminationdate'"><xsl:sequence select="'Termination date'"/></xsl:when>
    <xsl:when test="$local='rcn'"><xsl:sequence select="'CORDIS RCN'"/></xsl:when>
    <xsl:when test="$local=('identifier','hasIdentifier','hasidentifier')"><xsl:sequence select="'Project ID'"/></xsl:when>
    <xsl:when test="$local='hasAcronym'"><xsl:sequence select="'Acronym'"/></xsl:when>
    <xsl:when test="$local='hasInvolvedParty'"><xsl:sequence select="'Participant'"/></xsl:when>
    <xsl:when test="$local='hasResult'"><xsl:sequence select="'Results'"/></xsl:when>
    <xsl:when test="$local='hasEvent'"><xsl:sequence select="'Events'"/></xsl:when>
    <xsl:when test="$local='hasProjectDivision'"><xsl:sequence select="'Project division'"/></xsl:when>
    <xsl:when test="$local='hasRelatedProject'"><xsl:sequence select="'Related project'"/></xsl:when>
    <xsl:when test="$local='webLink'"><xsl:sequence select="'Project website'"/></xsl:when>
    <xsl:when test="$local='webResource'"><xsl:sequence select="'Web resource'"/></xsl:when>
    <xsl:when test="lower-case($local)='url'"><xsl:sequence select="'Project URL'"/></xsl:when>
    <xsl:when test="$local='startDate'"><xsl:sequence select="'Start date'"/></xsl:when>
    <xsl:when test="$local='endDate'"><xsl:sequence select="'End date'"/></xsl:when>
    <xsl:otherwise>
      <xsl:variable name="human" select="normalize-space(replace(replace(replace($local,'([a-z0-9])([A-Z])','$1 $2'),'([A-Z])([A-Z][a-z])','$1 $2'),'[-_]',' '))"/>
      <xsl:sequence select="if ($human != '') then concat(upper-case(substring($human,1,1)),substring($human,2)) else $iri"/>
    </xsl:otherwise>
  </xsl:choose>
</xsl:function>

<xsl:param name="recordUri"/>
<xsl:param name="maestroPhase" as="xs:string" select="'render'"/>
<xsl:variable name="rows" select="/mctx:context/mctx:describe/fct:facets/fct:result[@type='describe']/fct:row[normalize-space(string(fct:column[1])) = $recordUri]"/>
<xsl:variable name="rdfType" select="'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'"/>
<xsl:template match="/">
 <xsl:choose>
  <xsl:when test="$maestroPhase = 'queries'"><xsl:call-template name="eurio-runtime-label-queries"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://data.europa.eu/s66#Project'"><xsl:call-template name="RecordProject"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://data.europa.eu/s66#Organisation'"><xsl:call-template name="RecordOrganisation"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://data.europa.eu/s66#Person'"><xsl:call-template name="RecordPerson"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://data.europa.eu/s66#Grant'"><xsl:call-template name="RecordGrant"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://data.europa.eu/s66#Result'"><xsl:call-template name="RecordResult"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://data.europa.eu/s66#Role'"><xsl:call-template name="RecordRole"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://www.w3.org/ns/dcat#Dataset'"><xsl:call-template name="RecordDataset"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://www.w3.org/ns/dcat#Distribution'"><xsl:call-template name="RecordDistribution"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://www.w3.org/ns/dcat#DataService'"><xsl:call-template name="RecordDataService"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://www.w3.org/ns/dcat#Catalog'"><xsl:call-template name="RecordCatalog"/></xsl:when>
  <xsl:when test="$rows[fct:column[2] = $rdfType]/fct:column[3] = 'http://www.w3.org/ns/dcat#CatalogRecord'"><xsl:call-template name="RecordCatalogRecord"/></xsl:when>
  <xsl:otherwise>
    <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto max-w-4xl space-y-4 p-2 text-foreground">
     <h2 id="record-title" class="text-lg font-semibold">EU Data Explorer · Record</h2>
     <p class="text-sm text-muted-foreground" id="eu-fallback-p-1">No declared EURIO or DCAT-AP Record type matched. Use the Default Record viewer for all RDF properties.</p>
     <p class="break-all text-xs text-muted-foreground" id="eu-fallback-p-2"><xsl:value-of select="$recordUri"/></p>
    </section>
  </xsl:otherwise>
 </xsl:choose>
</xsl:template>


<!-- Domain-owned enrichment. The sandbox first renders this plan (maestroPhase
     = 'queries'), executes the bounded SELECT, then re-renders with returned
     FCT rows under mctx:enrichment. Every predicate/relationship here is
     specific to EURIO / EU Vocabularies, not to Maestro's generic Record API.
     No external documents, extension calls, or implicit data pivots. -->
<xsl:template name="eurio-runtime-label-queries">
  <mctx:requests>
    <xsl:variable name="linkedUris" as="xs:string*" select="distinct-values(
      for $value in $rows/fct:column[3][@termType = 'uri' or @datatype = 'uri'
       or matches(normalize-space(string(.)), '^https?://')]
      return normalize-space(string($value))
    )"/>
    <!-- Capture graph scope while the context item is still the input document.
         The batch loop below has xs:integer context items, not XML nodes. -->
    <xsl:variable name="runtimeGraph" as="xs:string" select="normalize-space(string(/mctx:context/mctx:query/*[local-name()='query']/@graph))"/>
    <xsl:for-each select="1 to xs:integer(ceiling(count($linkedUris) div 35))">
      <xsl:variable name="start" as="xs:integer" select="(. - 1) * 35 + 1"/>
      <mctx:request id="eurio-deep-labels-{.}">
        <xsl:text>PREFIX eurio: &lt;http://data.europa.eu/s66#&gt;
PREFIX rdfs: &lt;http://www.w3.org/2000/01/rdf-schema#&gt;
PREFIX skos: &lt;http://www.w3.org/2004/02/skos/core#&gt;
PREFIX xl: &lt;http://www.w3.org/2008/05/skos-xl#&gt;
PREFIX dcterms: &lt;http://purl.org/dc/terms/&gt;
PREFIX dc: &lt;http://purl.org/dc/elements/1.1/&gt;
PREFIX foaf: &lt;http://xmlns.com/foaf/0.1/&gt;
PREFIX schema: &lt;https://schema.org/&gt;
SELECT DISTINCT ?subject ?predicate ?object </xsl:text>
        <xsl:variable name="graph" select="$runtimeGraph"/>
        <xsl:if test="$graph != '' and matches($graph, '^[a-z][a-z0-9+.-]*:[^&lt;&gt;\s]+$')">
          <xsl:text>FROM &lt;</xsl:text><xsl:value-of select="$graph"/><xsl:text>&gt; </xsl:text>
        </xsl:if>
        <xsl:text>WHERE {
VALUES ?origin { </xsl:text>
        <xsl:for-each select="subsequence($linkedUris, $start, 35)">
          <xsl:if test="matches(., '^[a-z][a-z0-9+.-]*:[^&lt;&gt;\s&quot;{}|^`\\]+$')">
            <xsl:text>&lt;</xsl:text><xsl:value-of select="."/><xsl:text>&gt; </xsl:text>
          </xsl:if>
        </xsl:for-each>
        <xsl:text>}
{
  BIND(?origin AS ?subject)
  ?origin ?predicate ?object .
  FILTER (?predicate IN (
    rdfs:label, skos:prefLabel, skos:altLabel, xl:prefLabel,
    eurio:title, eurio:name, eurio:legalName, eurio:roleLabel,
    eurio:definition, eurio:code, eurio:hasFundingScheme,
    eurio:hasAssociatedFundingScheme, eurio:hasGrant,
    eurio:hasFundingSchemeProgramme, eurio:hasFundingSchemeCall,
    eurio:isRoleOf, eurio:hasBeneficiary, eurio:isImplementedBy,
    eurio:hasFundingAmount, eurio:hasEuroSciVocClassification,
    eurio:hasAcronym, eurio:hasOrganisation, eurio:hasAddress,
    eurio:hasNextFundingScheme, eurio:hasPreviousFundingScheme,
    eurio:hasProjectDivision, eurio:hasRelatedProject,
    dcterms:title, dc:title, foaf:name, schema:name,
    &lt;http://schema.org/name&gt;, skos:notation,
    xl:literalForm
  ))
} UNION {
  ?origin ?link ?subject .
  FILTER (?link IN (
    eurio:hasFundingScheme, eurio:hasAssociatedFundingScheme,
    eurio:hasFundingSchemeProgramme, eurio:hasFundingSchemeCall,
    eurio:hasGrant, eurio:isRoleOf, eurio:hasBeneficiary,
    eurio:isImplementedBy, eurio:hasEuroSciVocClassification,
    eurio:hasAcronym, eurio:hasOrganisation, eurio:hasAddress,
    eurio:hasNextFundingScheme, eurio:hasPreviousFundingScheme,
    eurio:hasProjectDivision, eurio:hasRelatedProject, xl:prefLabel
  ))
  ?subject ?predicate ?object .
  FILTER (?predicate IN (
    rdfs:label, skos:prefLabel, skos:altLabel, xl:prefLabel,
    xl:literalForm, eurio:title, eurio:name, eurio:legalName,
    eurio:roleLabel, eurio:definition, eurio:code,
    eurio:hasFundingScheme, eurio:isRoleOf, eurio:isImplementedBy,
    dcterms:title, dc:title, foaf:name, schema:name,
    &lt;http://schema.org/name&gt;, skos:notation
  ))
} UNION {
  ?origin ?link1 ?middle .
  FILTER (?link1 IN (
    eurio:hasFundingScheme, eurio:hasAssociatedFundingScheme,
    eurio:hasGrant, eurio:isRoleOf, eurio:hasBeneficiary,
    eurio:hasEuroSciVocClassification, eurio:hasAcronym,
    eurio:hasOrganisation, eurio:hasProjectDivision
  ))
  ?middle ?link2 ?subject .
  FILTER (?link2 IN (
    eurio:hasFundingScheme, eurio:isRoleOf, eurio:isImplementedBy,
    eurio:hasNextFundingScheme, eurio:hasPreviousFundingScheme,
    eurio:hasAssociatedFundingScheme, xl:prefLabel
  ))
  ?subject ?predicate ?object .
  FILTER (?predicate IN (
    rdfs:label, skos:prefLabel, skos:altLabel, xl:prefLabel,
    xl:literalForm, eurio:title, eurio:name, eurio:legalName,
    eurio:definition, eurio:code, dcterms:title, dc:title,
    foaf:name, schema:name, &lt;http://schema.org/name&gt;, skos:notation
  ))
}
} LIMIT 2400</xsl:text>
      </mctx:request>
    </xsl:for-each>
  </mctx:requests>
</xsl:template>

<xsl:template name="property-row">
  <xsl:param name="iri" as="xs:string"/>
  <xsl:param name="label" as="xs:string"/>
  <xsl:param name="relationship" as="xs:boolean" select="false()"/>
  <xsl:if test="$rows[fct:column[2] = $iri]">
    <div class="grid min-w-0 gap-2 border-b border-border px-4 py-3 last:border-0 sm:grid-cols-[minmax(9rem,30%)_minmax(0,1fr)] sm:gap-4" id="eu-field-{encode-for-uri($iri)}" data-maestro-property-row="true">
      <dt class="text-xs font-semibold text-muted-foreground" id="eu-field-label-{encode-for-uri($iri)}" about="{$iri}" data-maestro-predicate="{$iri}" data-maestro-property-label="true"><xsl:value-of select="$label"/></dt>
      <dd class="min-w-0 space-y-1.5 text-sm leading-relaxed" id="eu-field-values-{encode-for-uri($iri)}" data-maestro-predicate="{$iri}" data-maestro-direction="property">
        <xsl:for-each select="$rows[fct:column[2] = $iri]">
          <xsl:variable name="value" select="string(fct:column[3])"/>
          <xsl:variable name="termType" select="string(fct:column[3]/@termType)"/>
          <xsl:variable name="datatype" select="string(fct:column[3]/@datatype)"/>
          <xsl:variable name="lang" select="string((fct:column[3]/@xml:lang, fct:column[3]/@lang)[1])"/>
          <xsl:choose>
            <xsl:when test="$termType = 'uri' or $datatype = 'uri' or ($termType = '' and $datatype = '' and matches($value, '^https?://'))">
              <a rel="{$iri}" resource="{$value}" href="#" data-maestro-record-uri="{$value}" class="block min-w-0 break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-medium text-primary underline-offset-4 hover:bg-accent hover:underline" id="eu-field-uri-{encode-for-uri($iri)}-{position()}" data-maestro-predicate="{$iri}" data-maestro-direction="property" data-maestro-property-value="true"><xsl:choose><xsl:when test="string-length($value) &gt; 85"><xsl:value-of select="concat(substring($value,1,82),'…')"/></xsl:when><xsl:otherwise><xsl:value-of select="$value"/></xsl:otherwise></xsl:choose></a>
            </xsl:when>
            <xsl:otherwise>
              <span property="{$iri}" class="block break-words" id="eu-field-literal-{encode-for-uri($iri)}-{position()}" content="{$value}" data-maestro-predicate="{$iri}" data-maestro-direction="property" data-maestro-property-value="true"><xsl:if test="$datatype"><xsl:attribute name="datatype" select="$datatype"/></xsl:if><xsl:if test="$lang"><xsl:attribute name="xml:lang" select="$lang"/><xsl:attribute name="lang" select="$lang"/></xsl:if><xsl:value-of select="$value"/></span>
            </xsl:otherwise>
          </xsl:choose>
        </xsl:for-each>
      </dd>
    </div>
  </xsl:if>
</xsl:template>
<!-- Prefer the first asserted label of the *linked resource* from the
     deep DESCRIBE/enrichment rows. Never substitute the Project's own label,
     an unrelated resource's label, or a made-up local-name title. -->
<xsl:function name="fmt:linked-label" as="xs:string">
  <xsl:param name="term" as="element(fct:column)"/>
  <xsl:variable name="resource" select="normalize-space(string($term))"/>
  <xsl:variable name="resourceRows" select="$allDescribeRows[normalize-space(string(fct:column[1])) = $resource]"/>
  <xsl:variable name="labelRow" select="(
    $resourceRows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label'],
    $resourceRows[fct:column[2] = 'http://www.w3.org/2004/02/skos/core#prefLabel'],
    $resourceRows[fct:column[2] = 'http://data.europa.eu/s66#title'],
    $resourceRows[fct:column[2] = ('http://data.europa.eu/s66#name','http://data.europa.eu/s66#legalName')],
    $resourceRows[fct:column[2] = 'http://purl.org/dc/terms/title'],
    $resourceRows[fct:column[2] = ('http://schema.org/name','https://schema.org/name')],
    $resourceRows[fct:column[2] = ('http://data.europa.eu/s66#roleLabel',
      'http://data.europa.eu/s66#definition','http://data.europa.eu/s66#code',
      'http://www.w3.org/2004/02/skos/core#notation')]
  )[normalize-space(string(fct:column[3])) != ''][1]"/>
  <!-- EURIO ontology: isFundedBy points to Grant, and Grant hasFundingScheme
       points to FundingScheme. Resolve the named scheme, not the Grant UUID.
       EuroSciVoc concept labels are SKOS-XL resources two steps away. -->
  <xsl:variable name="schemeUris" select="$resourceRows[fct:column[2] = (
    'http://data.europa.eu/s66#hasFundingScheme',
    'http://data.europa.eu/s66#hasFundingSchemeProgramme',
    'http://data.europa.eu/s66#hasFundingSchemeCall',
    'http://data.europa.eu/s66#hasAssociatedFundingScheme'
  )]/fct:column[3]/string()"/>
  <xsl:variable name="schemeRows" select="$allDescribeRows[normalize-space(string(fct:column[1])) = $schemeUris]"/>
  <xsl:variable name="schemeLabelRow" select="(
    $schemeRows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label'],
    $schemeRows[fct:column[2] = 'http://www.w3.org/2004/02/skos/core#prefLabel'],
    $schemeRows[fct:column[2] = 'http://data.europa.eu/s66#title'],
    $schemeRows[fct:column[2] = ('http://schema.org/name','https://schema.org/name')],
    $schemeRows[fct:column[2] = 'http://data.europa.eu/s66#code']
  )[normalize-space(string(fct:column[3])) != ''][1]"/>
  <xsl:variable name="skosXlUris" select="($resourceRows,$schemeRows)[fct:column[2] = 'http://www.w3.org/2008/05/skos-xl#prefLabel']/fct:column[3]/string()"/>
  <xsl:variable name="skosXlLabelRow" select="$allDescribeRows[
    normalize-space(string(fct:column[1])) = $skosXlUris and
    fct:column[2] = 'http://www.w3.org/2008/05/skos-xl#literalForm' and
    normalize-space(string(fct:column[3])) != ''
  ][1]"/>
  <xsl:variable name="acronymDefinitionRow" select="$resourceRows[
    fct:column[2] = 'http://data.europa.eu/s66#definition' and
    normalize-space(string(fct:column[3])) != ''
  ][1]"/>
  <xsl:variable name="actorUris" select="$resourceRows[
    fct:column[2] = 'http://data.europa.eu/s66#isRoleOf'
  ]/fct:column[3]/string()"/>
  <xsl:variable name="actorLabelRow" select="($allDescribeRows[
    normalize-space(string(fct:column[1])) = $actorUris and
    fct:column[2] = (
      'http://data.europa.eu/s66#legalName', 'http://data.europa.eu/s66#name',
      'http://www.w3.org/2000/01/rdf-schema#label',
      'http://xmlns.com/foaf/0.1/name'
    )
  ])[normalize-space(string(fct:column[3])) != ''][1]"/>
  <xsl:sequence select="if ($labelRow) then normalize-space(string($labelRow/fct:column[3]))
    else if ($schemeLabelRow) then normalize-space(string($schemeLabelRow/fct:column[3]))
    else if ($skosXlLabelRow) then normalize-space(string($skosXlLabelRow/fct:column[3]))
    else if ($acronymDefinitionRow) then normalize-space(string($acronymDefinitionRow/fct:column[3]))
    else if ($actorLabelRow) then normalize-space(string($actorLabelRow/fct:column[3]))
    else if (normalize-space(string($term/@label)) != '') then normalize-space(string($term/@label))
    else $resource"/>
</xsl:function>

<!-- Project-specific helpers: use original FCT term identities and no fabricated values. -->
<xsl:variable name="eu" select="'http://data.europa.eu/s66#'"/>
<xsl:variable name="projectRows" select="$rows[normalize-space(string(fct:column[3])) != '']"/>
<xsl:variable name="allDescribeRows" select="(
 /mctx:context/mctx:describe/fct:facets/fct:result[@type='describe']/fct:row,
 /mctx:context/mctx:enrichment/fct:row
)"/>

<xsl:template name="project-value-attributes">
  <xsl:param name="row" as="element(fct:row)"/>
  <xsl:variable name="predicate" select="string($row/fct:column[2])"/>
  <xsl:variable name="term" select="$row/fct:column[3]"/>
  <xsl:variable name="value" select="string($term)"/>
  <xsl:variable name="kind" select="string($term/@termType)"/>
  <xsl:variable name="dt" select="string($term/@datatype)"/>
  <xsl:variable name="lang" select="string(($term/@xml:lang,$term/@lang)[1])"/>
  <xsl:attribute name="data-maestro-property-value">true</xsl:attribute>
  <xsl:attribute name="data-maestro-predicate" select="$predicate"/>
  <xsl:attribute name="data-maestro-direction">property</xsl:attribute>
  <xsl:choose>
    <xsl:when test="$kind = 'uri' or $dt = 'uri' or ($kind = '' and $dt = '' and matches($value, '^https?://'))">
      <xsl:attribute name="rel" select="$predicate"/>
      <xsl:attribute name="resource" select="$value"/>
      <xsl:attribute name="data-maestro-record-uri" select="$value"/>
    </xsl:when>
    <xsl:otherwise>
      <xsl:attribute name="property" select="$predicate"/>
      <xsl:attribute name="content" select="$value"/>
      <xsl:if test="$dt != '' and $dt != 'uri' and $lang = ''"><xsl:attribute name="datatype" select="$dt"/></xsl:if>
      <xsl:if test="$lang != ''"><xsl:attribute name="lang" select="$lang"/></xsl:if>
    </xsl:otherwise>
  </xsl:choose>
</xsl:template>

<xsl:template name="project-atom">
  <xsl:param name="row" as="element(fct:row)"/>
  <xsl:param name="id" as="xs:string"/>
  <xsl:param name="class" as="xs:string" select="'break-words text-sm leading-relaxed text-foreground underline-offset-2 hover:text-primary hover:underline'"/>
  <xsl:variable name="term" select="$row/fct:column[3]"/>
  <xsl:variable name="value" select="string($term)"/>
  <xsl:variable name="readable" select="fmt:linked-label($term)"/>
  <xsl:choose>
    <xsl:when test="$term/@termType = 'uri' or $term/@datatype = 'uri' or (not($term/@termType or $term/@datatype) and matches($value, '^https?://'))">
      <a id="{$id}" href="#" class="{$class}">
        <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$row"/></xsl:call-template>
        <xsl:if test="$readable != $value"><xsl:attribute name="data-maestro-preserve-formatted-label">true</xsl:attribute></xsl:if>
        <xsl:value-of select="$readable"/>
      </a>
    </xsl:when>
    <xsl:otherwise>
      <span id="{$id}" data-maestro-shift-only="true" class="{$class}">
        <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$row"/></xsl:call-template>
        <xsl:value-of select="$value"/>
      </span>
    </xsl:otherwise>
  </xsl:choose>
</xsl:template>

<!-- The URI-valued eurio:hasInvolvedParty column has an enriched @label.
     Parse that label for presentation; retain the original resource URI in RDFa. -->
<xsl:template name="project-involved-party">
  <xsl:param name="row" as="element(fct:row)"/>
  <xsl:param name="id" as="xs:string"/>
  <xsl:variable name="term" select="$row/fct:column[3]"/>
  <xsl:variable name="original" select="string($term)"/>
  <xsl:variable name="rawLabel" select="normalize-space(if (normalize-space(string($term/@label)) != '') then string($term/@label) else $original)"/>
  <xsl:variable name="raw" select="replace($rawLabel, '&amp;amp;', '&amp;')"/>
  <xsl:variable name="orgTail" select="if (contains($raw, 'Org:')) then substring-after($raw, 'Org:') else ''"/>
  <xsl:variable name="organization" select="normalize-space(if (contains($orgTail,'/ Role:')) then substring-before($orgTail,'/ Role:') else if (contains($orgTail,'Role:')) then substring-before($orgTail,'Role:') else $orgTail)"/>
  <xsl:variable name="roleTail" select="if (contains($raw, 'Role:')) then substring-after($raw, 'Role:') else ''"/>
  <xsl:variable name="role" select="normalize-space(if (contains($roleTail,'/ Project:')) then substring-before($roleTail,'/ Project:') else if (contains($roleTail,'Project:')) then substring-before($roleTail,'Project:') else $roleTail)"/>
  <xsl:variable name="project" select="normalize-space(if (contains($raw,'Project:')) then substring-after($raw,'Project:') else '')"/>
  <xsl:variable name="isUri" select="$term/@datatype = 'uri' or $term/@termType = 'uri'"/>
  <!-- Role icons occupy their own leading column in each list row; they
       must never interrupt the organisation/role text or inherit its link. -->
  <span id="{$id}-row" class="flex min-w-0 items-start gap-2">
    <xsl:choose>
      <xsl:when test="contains(lower-case($role),'coordinator')">
        <svg xmlns="http://www.w3.org/2000/svg" id="{$id}-role-coordinator-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Coordinator" role="img"><path id="{$id}-coordinator-tower" d="M6 22h12M9 22V9m6 13V9M7 9h10l-1-5H8zM12 2v2M8 13h8M8 17h8"/></svg>
      </xsl:when>
      <xsl:when test="contains(lower-case($role),'partner')">
        <svg xmlns="http://www.w3.org/2000/svg" id="{$id}-role-partner-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Partner" role="img"><path id="{$id}-partner-hands" d="m2 8 3-3 4 2 3-2 4 1 3 5-4 6-3-1-3-3-2 2-5-4zM9 7l3 2 4-3m-4 8 3 3M9 11l3 3"/></svg>
      </xsl:when>
    </xsl:choose>
    <xsl:choose>
    <xsl:when test="$isUri">
      <a id="{$id}" href="#" data-maestro-preserve-formatted-label="true" class="min-w-0 flex-1 break-words text-sm text-primary hover:underline">
        <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$row"/></xsl:call-template>
        <xsl:call-template name="project-party-display">
          <xsl:with-param name="organization" select="$organization"/><xsl:with-param name="role" select="$role"/><xsl:with-param name="project" select="$project"/><xsl:with-param name="fallback" select="$raw"/><xsl:with-param name="id" select="$id"/>
        </xsl:call-template>
      </a>
    </xsl:when>
    <xsl:otherwise>
      <span id="{$id}" class="min-w-0 flex-1 break-words text-sm text-foreground hover:text-primary hover:underline">
        <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$row"/></xsl:call-template>
        <xsl:call-template name="project-party-display">
          <xsl:with-param name="organization" select="$organization"/><xsl:with-param name="role" select="$role"/><xsl:with-param name="project" select="$project"/><xsl:with-param name="fallback" select="$raw"/><xsl:with-param name="id" select="$id"/>
        </xsl:call-template>
      </span>
    </xsl:otherwise>
    </xsl:choose>
  </span>
</xsl:template>

<xsl:template name="project-party-display">
  <xsl:param name="organization" as="xs:string"/>
  <xsl:param name="role" as="xs:string"/>
  <xsl:param name="project" as="xs:string"/>
  <xsl:param name="fallback" as="xs:string"/>
  <xsl:param name="id" as="xs:string"/>
  <xsl:choose>
    <xsl:when test="$organization != ''">
      <xsl:value-of select="$organization"/>
      <xsl:if test="$role != ''">
        <xsl:text> </xsl:text>
        <xsl:text> (</xsl:text><xsl:value-of select="lower-case($role)"/><xsl:text>)</xsl:text>
      </xsl:if>
      <xsl:if test="$project != ''"><xsl:text> | P-</xsl:text><xsl:value-of select="replace($project,'^P-','')"/></xsl:if>
    </xsl:when>
    <xsl:otherwise><xsl:value-of select="$fallback"/></xsl:otherwise>
  </xsl:choose>
</xsl:template>

<!-- SVG icons are actually rendered by the Record DOM. data-lucide-icon
     placeholders were not interpreted by this renderer. -->
<xsl:template name="project-status-svg">
  <xsl:param name="icon" as="xs:string"/>
  <svg xmlns="http://www.w3.org/2000/svg" id="eu-project-status-glyph" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5" aria-hidden="true">
    <xsl:choose>
      <xsl:when test="$icon = 'circle-fading-check'">
        <path id="eu-project-status-ring" d="M12 2a10 10 0 0 1 7.38 16.75"/>
        <path id="eu-project-status-check" d="m16 9-5.5 5.5L8 12"/>
        <path id="eu-project-status-ring-a" d="M2.5 8.875a10 10 0 0 0-.5 3"/>
        <path id="eu-project-status-ring-b" d="M2.83 16a10 10 0 0 0 2.43 3.4"/>
        <path id="eu-project-status-ring-c" d="M4.636 5.235a10 10 0 0 1 .891-.857"/>
        <path id="eu-project-status-ring-d" d="M8.644 21.42a10 10 0 0 0 7.631-.38"/>
      </xsl:when>
      <xsl:when test="$icon = 'circle-x'">
        <circle id="eu-project-status-ring" cx="12" cy="12" r="10"/>
        <path id="eu-project-status-mark" d="m15 9-6 6m0-6 6 6"/>
      </xsl:when>
      <xsl:otherwise>
        <circle id="eu-project-status-ring" cx="12" cy="12" r="10"/>
        <path id="eu-project-status-mark" d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2.1-2.5 4"/>
        <path id="eu-project-status-dot" d="M12 17h.01"/>
      </xsl:otherwise>
    </xsl:choose>
  </svg>
</xsl:template>

<!-- Detail groups are conditional, and also carry future/unrecognized predicates. -->
<!-- MonetaryAmount is an RDF resource; the linked label provides its
     currency and numeric value when its triples are not in DESCRIBE. Never
     replace the RDF URI stored in rel/resource/data-maestro-record-uri. -->
<xsl:template name="project-monetary">
  <xsl:param name="row" as="element(fct:row)"/>
  <xsl:param name="id" as="xs:string"/>
  <xsl:variable name="term" select="$row/fct:column[3]"/>
  <xsl:variable name="raw" select="normalize-space(if (normalize-space(string($term/@label)) != '') then string($term/@label) else string($term))"/>
  <xsl:variable name="currency" select="if (matches($raw,'^[A-Z]{3}\s')) then tokenize($raw,'\s+')[1] else ''"/>
  <xsl:variable name="amount" select="normalize-space(if ($currency != '') then substring-after($raw,$currency) else '')"/>
  <xsl:variable name="isAmount" select="$currency != '' and matches($amount,'^-?[0-9]+([.][0-9]+)?$')"/>
  <a id="{$id}" href="#" data-maestro-preserve-formatted-label="true" class="inline-flex min-w-0 flex-wrap items-center gap-1 text-sm text-primary hover:underline">
    <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$row"/></xsl:call-template>
    <xsl:choose>
      <xsl:when test="$isAmount">
        <span id="{$id}-amount" class="tabular-nums"><xsl:value-of select="format-number(xs:decimal($amount),'#.##0,##','eu')"/></span>
        <xsl:choose>
          <xsl:when test="$currency='EUR'">
            <svg xmlns="http://www.w3.org/2000/svg" id="{$id}-currency-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Euro"><path id="{$id}-currency-path" d="M4 10h12M4 14h12M19 6a8 8 0 1 0 0 12"/></svg>
          </xsl:when>
          <xsl:when test="$currency='USD'">
            <svg xmlns="http://www.w3.org/2000/svg" id="{$id}-currency-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><path id="{$id}-currency-path" d="M12 2v20M17 5H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6"/></svg>
          </xsl:when>
          <xsl:otherwise><span id="{$id}-currency-code" class="text-xs text-muted-foreground"><xsl:value-of select="$currency"/></span></xsl:otherwise>
        </xsl:choose>
      </xsl:when>
      <xsl:otherwise><xsl:value-of select="$raw"/></xsl:otherwise>
    </xsl:choose>
  </a>
</xsl:template>

<xsl:template name="project-detail-group">
  <xsl:param name="items" as="element(fct:row)*"/>
  <xsl:param name="prefix" as="xs:string"/>
  <xsl:param name="showLabel" as="xs:boolean" select="true()"/>
  <xsl:param name="singleLine" as="xs:boolean" select="false()"/>
  <xsl:for-each-group select="$items" group-by="string(fct:column[2])">
    <xsl:variable name="iri" select="current-grouping-key()"/>
    <xsl:variable name="label" select="fmt:property-label($iri)"/>
    <xsl:variable name="n" select="position()"/>
    <div id="{$prefix}-field-{$n}" class="{if ($singleLine) then 'w-full min-w-0' else 'min-w-0 space-y-1.5'}" data-maestro-property-row="true">
      <xsl:if test="$showLabel">
        <dt id="{$prefix}-name-{$n}" about="{$iri}" data-maestro-predicate="{$iri}" data-maestro-direction="property" data-maestro-property-label="true" class="text-xs text-muted-foreground">
          <xsl:value-of select="$label"/>
        </dt>
      </xsl:if>
      <dd id="{$prefix}-values-{$n}" data-maestro-predicate="{$iri}" data-maestro-direction="property" class="{if ($singleLine) then 'block w-full min-w-0 space-y-1.5 overflow-x-auto whitespace-nowrap' else 'flex min-w-0 flex-col gap-1.5'}">
        <xsl:for-each select="current-group()">
          <xsl:choose>
            <xsl:when test="$iri = concat($eu,'hasInvolvedParty')">
              <xsl:call-template name="project-involved-party"><xsl:with-param name="row" select="."/>
                <xsl:with-param name="id" select="concat($prefix, '-value-', $n, '-', position())"/>
              </xsl:call-template>
            </xsl:when>
            <xsl:when test="$iri = (concat($eu,'hasTotalCost'),concat($eu,'totalCost'))">
              <xsl:call-template name="project-monetary"><xsl:with-param name="row" select="."/>
                <xsl:with-param name="id" select="concat($prefix, '-value-', $n, '-', position())"/>
              </xsl:call-template>
            </xsl:when>
            <xsl:otherwise>
              <xsl:call-template name="project-atom">
                <xsl:with-param name="row" select="."/>
                <xsl:with-param name="id" select="concat($prefix, '-value-', $n, '-', position())"/>
              </xsl:call-template>
            </xsl:otherwise>
          </xsl:choose>
        </xsl:for-each>
      </dd>
    </div>
  </xsl:for-each-group>
</xsl:template>

<xsl:template name="RecordProject">
  <xsl:variable name="titleRow" select="($projectRows[fct:column[2] = concat($eu,'title')], $projectRows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label'], $projectRows[fct:column[2] = 'http://purl.org/dc/terms/title'])[1]"/>
  <xsl:variable name="acronymRow" select="($projectRows[fct:column[2] = concat($eu,'hasAcronym')])[1]"/>
  <!-- The source hasAcronym value is often a URI; its display name is in
       the DESCRIBE column's @label, not the URI lexical value. -->
  <xsl:variable name="acronymTerm" select="$acronymRow/fct:column[3]"/>
  <xsl:variable name="acronymRaw" select="normalize-space(if (normalize-space(string($acronymTerm/@label)) != '') then string($acronymTerm/@label) else if ($acronymTerm/@datatype = 'uri' or $acronymTerm/@termType = 'uri') then '' else string($acronymTerm))"/>
  <xsl:variable name="acronym" select="normalize-space(if (matches($acronymRaw, '^Acronym:\s*', 'i')) then substring-after($acronymRaw, ':') else if (matches($acronymRaw, '^\S+:\s')) then substring-before($acronymRaw, ':') else $acronymRaw)"/>
  <xsl:variable name="keywordRows" select="$projectRows[fct:column[2] = (concat($eu,'keyword'),concat($eu,'keywords'))]"/>
  <xsl:variable name="subjectRows" select="$projectRows[fct:column[2] = concat($eu,'subject')]"/>
  <xsl:variable name="abstractRows" select="$projectRows[matches(normalize-space(string(fct:column[2])),'[/#](abstract|projectAbstract)$','i')]"/>
  <xsl:variable name="descriptionRows" select="$projectRows[matches(normalize-space(string(fct:column[2])),'[/#](description|objective|summary|projectDescription|projectObjective)$','i')][not(fct:column[2] = $abstractRows/fct:column[2])]"/>
  <xsl:variable name="statusRow" select="($projectRows[fct:column[2] = concat($eu,'projectStatus')],$projectRows[fct:column[2] = concat($eu,'hasProjectStatus')],$projectRows[fct:column[2] = concat($eu,'status')])[1]"/>
  <xsl:variable name="statusValue" select="upper-case(normalize-space(string(($statusRow/fct:column[3]/@label,$statusRow/fct:column[3])[1])))"/>
  <xsl:variable name="statusCode" select="tokenize(replace($statusValue, '/$', ''), '[/#:]')[last()]"/>
  <xsl:variable name="startRow" select="($projectRows[fct:column[2] = concat($eu,'startDate')])[1]"/>
  <xsl:variable name="endRow" select="($projectRows[fct:column[2] = concat($eu,'endDate')])[1]"/>
  <xsl:variable name="durationRow" select="($projectRows[fct:column[2] = concat($eu,'duration')])[1]"/>
  <!-- Match the source project URL and termination date by actual predicate
       local name; ns1 is a dynamic prefix, not a stable RDF namespace. -->
  <xsl:variable name="urlRow" select="($projectRows[matches(normalize-space(string(fct:column[2])),'[/#]url$','i')], $projectRows[fct:column[2] = (concat($eu,'webLink'), 'http://schema.org/url', 'https://schema.org/url')])[1]"/>
  <xsl:variable name="projectUrl" select="normalize-space(string($urlRow/fct:column[3]))"/>
  <xsl:variable name="validProjectUrl" select="matches($projectUrl,'^https?://[^\s&lt;&gt;]+$','i')"/>
  <xsl:variable name="terminationRow" select="($projectRows[matches(normalize-space(string(fct:column[2])),'[/#]terminationdate$','i')])[1]"/>
  <xsl:variable name="terminationValue" select="normalize-space(string($terminationRow/fct:column[3]))"/>
  <xsl:variable name="hasTermination" select="substring($terminationValue,1,10) castable as xs:date"/>
  <!-- A TERMINATED status is authoritative even if no separate terminationDate
       was supplied. Never treat the recorded endDate as a terminationDate RDF term. -->
  <xsl:variable name="isTerminated" select="$statusCode = 'TERMINATED' or $hasTermination"/>
  <xsl:variable name="startValue" select="normalize-space(string($startRow/fct:column[3]))"/>
  <xsl:variable name="endValue" select="normalize-space(string($endRow/fct:column[3]))"/>
  <xsl:variable name="validDates" select="substring($startValue,1,10) castable as xs:date and substring($endValue,1,10) castable as xs:date and (if (substring($startValue,1,10) castable as xs:date and substring($endValue,1,10) castable as xs:date) then xs:date(substring($endValue,1,10)) gt xs:date(substring($startValue,1,10)) else false())"/>
  <xsl:variable name="dayCount" select="if ($validDates) then days-from-duration(xs:date(substring($endValue,1,10)) - xs:date(substring($startValue,1,10))) else 0"/>
  <xsl:variable name="durationRaw" select="normalize-space(string($durationRow/fct:column[3]))"/>
  <xsl:variable name="durationValid" select="matches($durationRaw, '^[0-9]+([.][0-9]+)?$')"/>
  <xsl:variable name="durationMonths" select="if ($durationValid) then xs:decimal($durationRaw) else 0"/>
  <!-- The timeline maps scheduled duration to start + duration.
       For active projects, blue ends at today and the future scheduled
       interval is muted. The original endDate remains independent. -->
  <xsl:variable name="durationEnd" select="if ($validDates and $durationValid) then
    xs:date(substring($startValue,1,10)) + xs:yearMonthDuration(concat('P', floor($durationMonths), 'M')) +
    xs:dayTimeDuration(concat('P', round(($durationMonths - floor($durationMonths)) * 30.436875), 'D')) else ()"/>
  <xsl:variable name="durationPosition" select="if (exists($durationEnd) and $dayCount gt 0)
    then max((0, min((100, 100 * days-from-duration($durationEnd - xs:date(substring($startValue,1,10))) div $dayCount))))
    else 50"/>
  <!-- EURIO's endDate is a recorded endpoint, not proof of normal completion;
       do not equate it with a separate termination date. The duration bar
       depicts recorded months, not a verified fraction of work completed. -->
  <xsl:variable name="isOngoing" select="not($statusCode = 'CLOSED' or $isTerminated)"/>
  <xsl:variable name="today" select="current-date()"/>
  <xsl:variable name="todayPosition" select="if ($validDates and $dayCount gt 0)
    then max((0, min((100, 100 * days-from-duration($today - xs:date(substring($startValue,1,10))) div $dayCount))))
    else 0"/>
  <xsl:variable name="todayInRange" select="$isOngoing and not($hasTermination) and $validDates and $today ge xs:date(substring($startValue,1,10)) and $today le xs:date(substring($endValue,1,10))"/>
  <xsl:variable name="terminationPosition" select="if ($hasTermination and $validDates and $dayCount gt 0) then max((0,min((100,100 * days-from-duration(xs:date(substring($terminationValue,1,10)) - xs:date(substring($startValue,1,10))) div $dayCount)))) else 0"/>
  <xsl:variable name="showTerminationPin" select="$validDates and $isTerminated"/>
  <xsl:variable name="terminationPinPosition" select="if ($hasTermination) then $terminationPosition else 100"/>
  <!-- If a scheduled duration and termination occupy the same point, present
       one RED pin carrying both pieces of information, never a blue overlay. -->
  <xsl:variable name="coincidentPins" select="$showTerminationPin and $durationValid and abs($durationPosition - $terminationPinPosition) lt 0.5"/>
  <!-- Keep both segments on the same date scale and never extend either
       segment beyond the duration pin, even when endDate differs. -->
  <xsl:variable name="elapsedDurationPosition" select="if ($hasTermination and $validDates) then (if ($durationValid) then min(($durationPosition,$terminationPosition)) else $terminationPosition) else if ($isOngoing) then min(($durationPosition,$todayPosition)) else $durationPosition"/>
  <xsl:variable name="remainingDurationPosition" select="if ($isOngoing) then max((0,$durationPosition - $elapsedDurationPosition)) else 0"/>
  <xsl:variable name="resultRows" select="$projectRows[fct:column[2] = concat($eu,'hasResult')]"/>
  <xsl:variable name="knownDetailIris" select="(concat($eu,'identifier'),concat($eu,'hasidentifier'),concat($eu,'hasIdentifier'),concat($eu,'hasTotalCost'),concat($eu,'totalCost'),concat($eu,'ecMaxContribution'),concat($eu,'isFundedBy'),concat($eu,'fieldOfScience'),concat($eu,'businessSector'),concat($eu,'hasEuroSciVocClassification'),concat($eu,'hasInvolvedParty'),concat($eu,'hasEvent'),concat($eu,'hasProjectDivision'),concat($eu,'hasRelatedProject'),concat($eu,'webLink'),concat($eu,'webResource'))"/>
  <xsl:variable name="summaryIris" select="(concat($eu,'identifier'),concat($eu,'hasidentifier'),concat($eu,'hasIdentifier'),concat($eu,'hasTotalCost'),concat($eu,'totalCost'),concat($eu,'ecMaxContribution'),concat($eu,'isFundedBy'),concat($eu,'fieldOfScience'),concat($eu,'businessSector'),concat($eu,'hasEuroSciVocClassification'))"/>
  <xsl:variable name="participantsIris" select="(concat($eu,'hasInvolvedParty'))"/>
  <xsl:variable name="linksIris" select="(concat($eu,'webLink'),concat($eu,'webResource'))"/>
  <xsl:variable name="relationshipsIris" select="(concat($eu,'hasEvent'),concat($eu,'hasProjectDivision'),concat($eu,'hasRelatedProject'))"/>
  <xsl:variable name="usedIris" select="(string($titleRow/fct:column[2]),string($urlRow/fct:column[2]),string($terminationRow/fct:column[2]),concat($eu,'keyword'),concat($eu,'keywords'),concat($eu,'subject'),concat($eu,'abstract'),concat($eu,'description'),concat($eu,'objective'),concat($eu,'projectStatus'),concat($eu,'hasProjectStatus'),concat($eu,'status'),concat($eu,'hasAcronym'),concat($eu,'startDate'),concat($eu,'endDate'),concat($eu,'duration'),concat($eu,'hasResult'))"/>
  <!-- Catch long literal narrative fields even when their predicate is unknown.
       Exclude known detail/structural predicates and all RDF resource terms. -->
  <xsl:variable name="additionalLongTextRows" select="$projectRows[
    not(fct:column[2] = ($usedIris,$knownDetailIris,$abstractRows/fct:column[2],$descriptionRows/fct:column[2],$rdfType))
    and not(fct:column[3]/@termType = 'uri' or fct:column[3]/@datatype = 'uri')
    and string-length(normalize-space(string(fct:column[3]))) ge 300
  ]"/>
  <xsl:variable name="summaryRows" select="$projectRows[fct:column[2] = $summaryIris]"/>
  <xsl:variable name="participantRows" select="$projectRows[fct:column[2] = $participantsIris]"/>
  <xsl:variable name="relationshipRows" select="$projectRows[fct:column[2] = $relationshipsIris]"/>
  <xsl:variable name="linkRows" select="$projectRows[fct:column[2] = $linksIris]"/>
  <xsl:variable name="otherRows" select="$projectRows[not(fct:column[2] = ($usedIris,$knownDetailIris,$abstractRows/fct:column[2],$descriptionRows/fct:column[2],$additionalLongTextRows/fct:column[2],'http://www.w3.org/2000/01/rdf-schema#label'))][not(fct:column[2] = $rdfType and string(fct:column[3]) = concat($eu,'Project'))]"/>
  <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-5 p-3 text-foreground sm:p-5" aria-label="EURIO Project Record">
    <header id="record-header" class="space-y-4">
      <div id="eu-project-eyebrow" class="flex min-h-8 items-stretch bg-sky-50 text-[11px] uppercase tracking-wider text-sky-950 dark:bg-sky-950/25 dark:text-sky-100">
        <div id="eu-project-status-rail" aria-hidden="true" class="w-1 shrink-0 {if ($isTerminated) then 'bg-red-600 dark:bg-red-400' else if ($statusCode = ('SIGNED','CLOSED')) then 'bg-green-600 dark:bg-green-400' else 'bg-muted-foreground'}"/>
        <div id="eu-project-banner-content" class="flex flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5">
          <span id="eu-project-source" class="shrink-0 font-semibold">CORDIS / EURIO</span>
          <div id="eu-project-class-meta" class="flex min-w-0 flex-wrap items-center gap-1.5">
          <span id="eu-project-class">Project</span>
          <xsl:if test="$acronymRow and $acronym != '' ">
            <!-- Lucide Dot: compact visual separator, not a new RDF predicate. -->
            <svg xmlns="http://www.w3.org/2000/svg" id="eu-project-acronym-separator" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true" class="size-4 shrink-0"><path id="eu-project-acronym-separator-dot" d="M12 12h.01"/></svg>
            <xsl:choose>
              <xsl:when test="$acronymTerm/@datatype = 'uri' or $acronymTerm/@termType = 'uri'">
                <a id="eu-project-acronym" href="#" data-maestro-preserve-formatted-label="true" class="min-w-0 break-words font-medium normal-case tracking-normal text-primary hover:underline">
                  <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$acronymRow"/></xsl:call-template>
                  <xsl:value-of select="$acronym"/>
                </a>
              </xsl:when>
              <xsl:otherwise>
                <span id="eu-project-acronym" class="min-w-0 break-words font-medium normal-case tracking-normal">
                  <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$acronymRow"/></xsl:call-template>
                  <xsl:value-of select="$acronym"/>
                </span>
              </xsl:otherwise>
            </xsl:choose>
          </xsl:if>
          <xsl:variable name="icon" select="if ($statusCode = 'SIGNED') then 'circle-fading-check' else if ($statusCode = ('CLOSED','TERMINATED')) then 'circle-x' else 'circle-question-mark'"/>
          <xsl:variable name="statusLabel" select="if ($statusCode = 'SIGNED') then 'Signed' else if ($statusCode = 'CLOSED') then 'Closed' else if ($statusCode = 'TERMINATED') then 'Terminated' else if ($statusRow) then string($statusRow/fct:column[3]) else 'Unknown status'"/>
          <xsl:if test="$statusRow">
            <svg xmlns="http://www.w3.org/2000/svg" id="eu-project-status-separator" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true" class="size-4 shrink-0"><path id="eu-project-status-separator-dot" d="M12 12h.01"/></svg>
          </xsl:if>
          <xsl:choose>
            <xsl:when test="$statusRow">
              <span id="eu-project-status-icon" title="{$statusLabel}" role="img" aria-label="{$statusLabel}" class="inline-flex shrink-0 items-center justify-center {if ($isTerminated) then 'text-red-600 dark:text-red-400' else if ($statusCode = ('SIGNED','CLOSED')) then 'text-green-600 dark:text-green-400' else 'text-muted-foreground'}">
                <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$statusRow"/></xsl:call-template>
                <span id="eu-project-status-text" class="sr-only"><xsl:value-of select="string($statusRow/fct:column[3])"/></span>
                <xsl:call-template name="project-status-svg"><xsl:with-param name="icon" select="$icon"/></xsl:call-template>
              </span>
            </xsl:when>
            <xsl:otherwise>
              <span id="eu-project-status-icon" title="Unknown status" role="img" aria-label="Unknown status" class="inline-flex shrink-0 items-center justify-center text-muted-foreground">
                <xsl:call-template name="project-status-svg"><xsl:with-param name="icon" select="'circle-question-mark'"/></xsl:call-template>
              </span>
            </xsl:otherwise>
          </xsl:choose>
          </div>
        </div>
      </div>
      <div id="eu-project-title-area" class="space-y-2">
        <div id="eu-project-title-row" class="flex items-start justify-between gap-4">
          <h2 id="record-title" class="min-w-0 break-words text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            <xsl:choose>
              <xsl:when test="$titleRow">
                <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$titleRow"/></xsl:call-template>
                <xsl:choose>
                  <xsl:when test="$validProjectUrl">
                    <a id="eu-project-title-link" data-maestro-external-link="true" href="{$projectUrl}" target="_blank" rel="noopener noreferrer" class="text-inherit underline decoration-muted-foreground/40 decoration-1 underline-offset-4 hover:decoration-current" title="Open project website"><xsl:value-of select="string($titleRow/fct:column[3])"/></a>
                  </xsl:when>
                  <xsl:otherwise><xsl:value-of select="string($titleRow/fct:column[3])"/></xsl:otherwise>
                </xsl:choose>
              </xsl:when>
              <xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise>
            </xsl:choose>
          </h2>
        </div>
        <xsl:if test="exists($keywordRows)">
          <p id="eu-project-keywords" class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <xsl:for-each select="$keywordRows">
              <xsl:if test="position() gt 1"><span id="eu-project-keyword-sep-{position()}" aria-hidden="true">·</span></xsl:if>
              <xsl:call-template name="project-atom">
                <xsl:with-param name="row" select="."/>
                <xsl:with-param name="id" select="concat('eu-project-keyword-',position())"/>
                <xsl:with-param name="class" select="'text-xs text-muted-foreground'"/>
              </xsl:call-template>
            </xsl:for-each>
          </p>
        </xsl:if>
        <xsl:if test="exists($subjectRows)">
          <div id="eu-project-subject" class="space-y-1 text-sm text-muted-foreground">
            <xsl:for-each select="$subjectRows">
              <p id="eu-project-subject-line-{position()}" class="leading-relaxed">
                <xsl:call-template name="project-atom"><xsl:with-param name="row" select="."/><xsl:with-param name="id" select="concat('eu-project-subject-value-',position())"/><xsl:with-param name="class" select="'text-sm text-muted-foreground'"/></xsl:call-template>
              </p>
            </xsl:for-each>
          </div>
        </xsl:if>
      </div>
    </header>

    <xsl:if test="exists(($startRow,$endRow,$durationRow,$terminationRow))">
      <section id="eu-project-timeline" aria-label="Project timeline" class="border-t border-border pt-5">
        <div id="eu-project-timeline-visual" class="relative h-14">
          <div id="eu-project-track" class="absolute inset-x-0 top-9 h-1.5 rounded-full bg-muted"/>
          <xsl:if test="$validDates and ($durationValid or $hasTermination)">
            <!-- Future scheduled months are visibly muted for active projects.
                 The existing duration pin always stays at start + duration. -->
            <xsl:if test="$remainingDurationPosition gt 0">
              <div id="eu-project-track-remaining" aria-label="Scheduled remaining project duration" style="left: {format-number($elapsedDurationPosition,'0.##')}%; width: {format-number($remainingDurationPosition,'0.##')}%;" class="absolute top-9 h-1.5 bg-sky-500/25"/>
            </xsl:if>
            <div id="eu-project-track-fill" aria-label="Elapsed project duration" style="width: {format-number($elapsedDurationPosition,'0.##')}%;" class="absolute left-0 top-9 h-1.5 rounded-full {if ($isTerminated) then 'bg-red-500/85' else 'bg-sky-500/80'}"/>
          </xsl:if>
          <xsl:if test="$todayInRange">
            <div id="eu-project-today-marker" title="Today · project not marked completed" aria-label="Today" style="left: {format-number($todayPosition,'0.##')}%;" class="absolute top-0 z-10 flex -translate-x-1/2 flex-col items-center whitespace-nowrap text-amber-700 dark:text-amber-300">
              <span id="eu-project-today-value" class="text-xs font-medium">Today</span>
              <span id="eu-project-today-leader" aria-hidden="true" class="mt-1 h-4 w-px bg-amber-600/80"/>
              <span id="eu-project-today-dot" aria-hidden="true" class="size-2 rounded-full bg-amber-600"/>
            </div>
          </xsl:if>
          <xsl:if test="$showTerminationPin">
            <div id="eu-project-termination-marker" style="left: {format-number($terminationPinPosition,'0.##')}%; transform: translateX({if ($terminationPinPosition ge 80) then '-100%' else if ($terminationPinPosition le 20) then '0%' else '-50%'}); align-items: {if ($terminationPinPosition ge 80) then 'flex-end' else if ($terminationPinPosition le 20) then 'flex-start' else 'center'};" class="group/termination absolute top-0 z-20 hover:z-50 flex flex-col whitespace-nowrap text-red-600 dark:text-red-400" title="{if ($hasTermination) then concat('Project stopped on ', substring($terminationValue,1,10)) else 'CORDIS marks this project as terminated. A separate termination date was not provided; this marker is at its recorded end date.'}">
              <xsl:choose>
                <xsl:when test="$hasTermination">
                  <time id="eu-project-termination-value" datetime="{$terminationValue}" class="relative z-20 rounded-sm bg-background px-1 whitespace-nowrap text-xs font-medium tabular-nums">
                    <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$terminationRow"/></xsl:call-template>
                    <xsl:text>Terminated </xsl:text><xsl:value-of select="substring($terminationValue,1,10)"/>
                  </time>
                </xsl:when>
                <xsl:otherwise><span id="eu-project-termination-value" class="relative z-20 rounded-sm bg-background px-1 text-xs font-medium">Terminated</span></xsl:otherwise>
              </xsl:choose>
              <xsl:if test="$coincidentPins">
                <span id="eu-project-termination-duration" class="relative z-30 rounded-sm bg-background px-1 text-xs tabular-nums">
                  <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$durationRow"/></xsl:call-template>
                  <xsl:value-of select="fmt:months(string($durationRow/fct:column[3]))"/>
                </span>
              </xsl:if>
              <span id="eu-project-termination-leader" aria-hidden="true" class="mt-1 h-4 w-px bg-red-600/80"/>
              <span id="eu-project-termination-dot" aria-hidden="true" class="size-2 rounded-full bg-red-600"/>
            </div>
          </xsl:if>
          <xsl:if test="$durationRow and not($coincidentPins)">
            <div id="eu-project-duration-marker" style="left: {format-number($durationPosition,'0.##')}%;" class="group/duration absolute top-0 z-30 hover:z-50 flex -translate-x-1/2 flex-col items-center whitespace-nowrap">
              <span id="eu-project-duration-value" class="relative z-30 rounded-sm bg-background px-1 text-xs font-medium tabular-nums text-foreground">
                <xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$durationRow"/></xsl:call-template>
                <xsl:value-of select="fmt:months(string($durationRow/fct:column[3]))"/>
              </span>
              <span id="eu-project-duration-leader" aria-hidden="true" class="mt-1 h-4 w-px bg-sky-500/80"/>
              <span id="eu-project-duration-dot" aria-hidden="true" class="size-2 rounded-full bg-sky-500"/>
            </div>
          </xsl:if>
        </div>
        <xsl:if test="$startRow or $endRow or ($hasTermination and not($validDates))">
          <div id="eu-project-timeline-dates" class="flex items-center {if ($startRow and $endRow) then 'justify-between' else if ($endRow) then 'justify-end' else 'justify-start'} gap-3 text-xs tabular-nums text-muted-foreground">
            <xsl:if test="$startRow"><time id="eu-project-start-date" class="cursor-pointer hover:text-primary hover:underline" datetime="{$startValue}"><xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$startRow"/></xsl:call-template><xsl:value-of select="$startValue"/></time></xsl:if>
            <xsl:if test="$endRow"><time id="eu-project-end-date" class="cursor-pointer hover:text-primary hover:underline" datetime="{$endValue}"><xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$endRow"/></xsl:call-template><xsl:value-of select="$endValue"/></time></xsl:if>
            <xsl:if test="$hasTermination and not($validDates)"><time id="eu-project-termination-unscaled" datetime="{$terminationValue}" class="text-red-600 dark:text-red-400"><xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="$terminationRow"/></xsl:call-template><xsl:text>Terminated </xsl:text><xsl:value-of select="substring($terminationValue,1,10)"/></time></xsl:if>
          </div>
        </xsl:if>
        <!-- EURIO status is an administrative project state, NOT an assertion
             that its planned-duration bar measures actual work completed. -->
        <xsl:if test="$statusRow">
          <p id="eu-project-status-explanation" class="mt-3 text-xs leading-relaxed {if ($isTerminated) then 'text-red-700 dark:text-red-400' else 'text-muted-foreground'}">
            <xsl:choose>
              <xsl:when test="$isTerminated"><xsl:text>CORDIS says this project was stopped rather than completed normally.</xsl:text><xsl:if test="not($hasTermination)"><xsl:text> The date at the end of the timeline is the recorded project end date; a separate termination date was not provided.</xsl:text></xsl:if></xsl:when>
              <xsl:when test="$statusCode = 'CLOSED'">CORDIS records this project as closed, meaning its activities and administration have finished.</xsl:when>
              <xsl:when test="$statusCode = 'SIGNED'">The funding agreement has been signed. The project may be underway or preparing to start; the dates show its planned schedule.</xsl:when>
              <xsl:otherwise>CORDIS has not provided a clearly recognized project status.</xsl:otherwise>
            </xsl:choose>
          </p>
        </xsl:if>
      </section>
    </xsl:if>

    <xsl:if test="exists(($abstractRows,$descriptionRows,$additionalLongTextRows))">
      <section id="eu-project-narrative" class="space-y-4 text-sm leading-relaxed sm:text-base">
        <xsl:for-each select="$abstractRows">
          <p id="eu-project-abstract-{position()}" data-maestro-expandable="true" class="break-words whitespace-pre-line leading-relaxed">
            <xsl:call-template name="project-atom"><xsl:with-param name="row" select="."/><xsl:with-param name="id" select="concat('eu-project-abstract-value-',position())"/><xsl:with-param name="class" select="'cursor-pointer break-words text-foreground hover:text-primary'"/></xsl:call-template>
          </p>
        </xsl:for-each>
        <xsl:for-each select="$descriptionRows">
          <p id="eu-project-description-{position()}" data-maestro-expandable="true" class="break-words whitespace-pre-line leading-relaxed text-muted-foreground">
            <xsl:call-template name="project-atom"><xsl:with-param name="row" select="."/><xsl:with-param name="id" select="concat('eu-project-description-value-',position())"/><xsl:with-param name="class" select="'break-words text-muted-foreground'"/></xsl:call-template>
          </p>
        </xsl:for-each>
        <xsl:for-each select="$additionalLongTextRows">
          <p id="eu-project-longtext-{position()}" data-maestro-expandable="true" class="break-words whitespace-pre-line leading-relaxed text-muted-foreground">
            <xsl:call-template name="project-atom"><xsl:with-param name="row" select="."/><xsl:with-param name="id" select="concat('eu-project-longtext-value-',position())"/><xsl:with-param name="class" select="'cursor-pointer break-words text-muted-foreground hover:text-primary'"/></xsl:call-template>
          </p>
        </xsl:for-each>
      </section>
    </xsl:if>

    <!-- Separate Results section, immediately after the narrative, like Details.
         Pagination and individual Result RDFa remain unchanged. -->
    <xsl:if test="exists($resultRows)">
      <section id="eu-project-results-section" class="space-y-4 border-t border-border pt-5" aria-label="Project results">
        <div id="eu-project-results-heading" class="flex items-baseline justify-between gap-3">
          <h3 id="eu-project-results-title" class="text-base font-medium tracking-tight">Findings and Results</h3>
          <span id="eu-project-results-count" class="text-xs tabular-nums text-muted-foreground"><xsl:value-of select="count($resultRows)"/></span>
        </div>
        <div id="eu-project-results" class="rounded-xl border border-border p-4" role="region" aria-label="Project results table">
        <!-- The native RecordValuePages host keeps RDFa and Record navigation
             while presenting 5/10/20 results per page, never more than 20. -->
        <RecordValuePages id="eu-project-results-list" pageSize="5" maxPageSize="20" pageSizeSelect="true" listTag="ol" listClassName="min-w-0 divide-y divide-border" layout="groups">
          <xsl:for-each select="$resultRows">
            <xsl:variable name="n" select="position()"/>
            <xsl:variable name="resultUri" select="string(fct:column[3])"/>
            <xsl:variable name="resultPredicate" select="string(fct:column[2])"/>
            <xsl:variable name="metadata" select="$allDescribeRows[normalize-space(string(fct:column[1])) = normalize-space($resultUri)]"/>
            <xsl:variable name="resultTitleRow" select="($metadata[fct:column[2] = concat($eu,'title')],$metadata[fct:column[2]='http://purl.org/dc/terms/title'],$metadata[fct:column[2]='http://www.w3.org/2000/01/rdf-schema#label'])[1]"/>
            <xsl:variable name="doiRow" select="($metadata[fct:column[2] = concat($eu,'doi')])[1]"/>
            <xsl:variable name="doiLiteral" select="normalize-space(string($doiRow/fct:column[3]))"/>
            <xsl:variable name="doi" select="replace(replace($doiLiteral,'^https?://(?:dx\.)?doi\.org/',''),'^doi:','', 'i')"/>
            <li id="eu-project-result-{$n}" class="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-start gap-3 py-3 first:pt-1 last:pb-1" data-maestro-statement="true">
              <span id="eu-project-result-number-{$n}" class="pt-0.5 text-xs tabular-nums text-muted-foreground"><xsl:value-of select="format-number($n,'00')"/></span>
              <div id="eu-project-result-details-{$n}" class="min-w-0">
                <a id="eu-project-result-link-{$n}" href="#" class="block break-words text-sm font-medium text-foreground underline-offset-2 hover:text-primary hover:underline" rel="{$resultPredicate}" resource="{$resultUri}" data-maestro-record-uri="{$resultUri}" data-maestro-predicate="{$resultPredicate}" data-maestro-direction="property" data-maestro-property-value="true" data-maestro-preserve-formatted-label="true">
                  <xsl:value-of select="if ($resultTitleRow and normalize-space(string($resultTitleRow/fct:column[3]))) then string($resultTitleRow/fct:column[3]) else if (normalize-space(string(fct:column[3]/@label)) != '') then string(fct:column[3]/@label) else $resultUri"/>
                </a>
              </div>
              <div id="eu-project-result-document-{$n}" class="flex min-w-0 justify-end" data-maestro-result-doi="{if ($doiRow) then 'available' else 'absent'}">
                <xsl:if test="$doiRow and matches($doi,'^10\.[0-9]{4,9}/\S+$')">
                  <a id="eu-project-doi-link-{$n}" data-maestro-external-link="true" href="{concat('https://doi.org/',replace(encode-for-uri($doi),'%2F','/'))}" target="_blank" rel="noopener noreferrer" aria-label="Open DOI document {$doi}" title="Open DOI document {$doi}" class="inline-flex size-7 items-center justify-center rounded-sm text-primary hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    <!-- Lucide file-chart-column, with stable SVG element IDs for Record navigation. -->
                    <svg xmlns="http://www.w3.org/2000/svg" id="eu-project-doi-icon-{$n}" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" aria-hidden="true" class="size-4"><path id="eu-project-doi-axis-{$n}" d="M3 3v18h18"/><path id="eu-project-doi-column-a-{$n}" d="M8 16v-3"/><path id="eu-project-doi-column-b-{$n}" d="M13 16V9"/><path id="eu-project-doi-column-c-{$n}" d="M18 16V5"/><path id="eu-project-doi-chart-outline-{$n}" d="M6 3h15v18"/></svg>
                    <span id="eu-project-doi-rdfa-{$n}" about="{$resultUri}" property="{string($doiRow/fct:column[2])}" content="{$doiLiteral}" class="sr-only"><xsl:if test="$doiRow/fct:column[3]/@datatype"><xsl:attribute name="datatype" select="string($doiRow/fct:column[3]/@datatype)"/></xsl:if><xsl:value-of select="$doiLiteral"/></span>
                  </a>
                </xsl:if>
              </div>
            </li>
          </xsl:for-each>
        </RecordValuePages>
        </div>
      </section>
    </xsl:if>

    <xsl:if test="exists(($summaryRows,$participantRows,$relationshipRows,$linkRows,$otherRows))">
      <section id="eu-project-details" class="space-y-5 border-t border-border pt-5" aria-label="Project details">
        <h3 id="eu-project-details-heading" class="text-base font-medium tracking-tight">Details</h3>
        <xsl:if test="exists($summaryRows)">
          <dl id="eu-project-details-grid" class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <xsl:call-template name="project-detail-group"><xsl:with-param name="items" select="$summaryRows"/><xsl:with-param name="prefix" select="'eu-project-summary'"/></xsl:call-template>
          </dl>
        </xsl:if>
        <xsl:if test="exists($participantRows)">
          <div id="eu-project-participants" class="space-y-3 border-t border-border pt-4">
            <h4 id="eu-project-participants-heading" class="text-xs font-medium text-muted-foreground">Participants</h4>
            <ul id="eu-project-participants-list" class="list-none space-y-2 p-0 text-sm">
              <xsl:for-each select="$participantRows">
                <li id="eu-project-participant-{position()}" class="min-w-0 break-words p-0" data-maestro-statement="true">
                  <xsl:call-template name="project-involved-party">
                    <xsl:with-param name="row" select="."/>
                    <xsl:with-param name="id" select="concat('eu-project-participant-value-',position())"/>
                  </xsl:call-template>
                </li>
              </xsl:for-each>
            </ul>
          </div>
        </xsl:if>
        <xsl:if test="exists($relationshipRows)">
          <div id="eu-project-relationships" class="space-y-3 border-t border-border pt-4">
            <h4 id="eu-project-relationships-heading" class="text-xs font-medium text-muted-foreground">Other relationships</h4>
            <dl id="eu-project-relationships-list" class="grid gap-x-8 gap-y-3 sm:grid-cols-2"><xsl:call-template name="project-detail-group"><xsl:with-param name="items" select="$relationshipRows"/><xsl:with-param name="prefix" select="'eu-project-relationships'"/></xsl:call-template></dl>
          </div>
        </xsl:if>
        <xsl:if test="exists($linkRows)">
          <div id="eu-project-resources" class="space-y-3 border-t border-border pt-4">
            <h4 id="eu-project-resources-heading" class="text-xs font-medium text-muted-foreground">Official project resources</h4>
            <dl id="eu-project-resources-list" class="grid gap-x-8 gap-y-3 sm:grid-cols-2"><xsl:call-template name="project-detail-group"><xsl:with-param name="items" select="$linkRows"/><xsl:with-param name="prefix" select="'eu-project-resources'"/></xsl:call-template></dl>
          </div>
        </xsl:if>
        <xsl:if test="exists($otherRows)">
          <div id="eu-project-other" class="space-y-3 border-t border-border pt-4">
            <h4 id="eu-project-other-heading" class="text-xs font-medium text-muted-foreground">More information</h4>
            <dl id="eu-project-other-grid" class="grid gap-x-8 gap-y-3 sm:grid-cols-2"><xsl:call-template name="project-detail-group"><xsl:with-param name="items" select="$otherRows"/><xsl:with-param name="prefix" select="'eu-project-other'"/></xsl:call-template></dl>
          </div>
        </xsl:if>
      </section>
    </xsl:if>
  </section>
</xsl:template>
<xsl:template name="RecordOrganisation">
 <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 text-foreground" aria-label="Research organisation Record">
   <header class="space-y-3 border-b border-border pb-4" id="record-header">
     <div class="flex flex-wrap items-center justify-between gap-2" id="eu-recordorganisation-div-1"><span class="text-xs font-semibold uppercase tracking-wide text-primary" id="eu-recordorganisation-span-1">EU Data Explorer</span><span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" id="eu-recordorganisation-span-2">EURIO · Research organisation</span></div>
     <xsl:variable name="headingTerm" select="($rows[fct:column[2] = 'http://data.europa.eu/s66#legalName']/fct:column[3], $rows[fct:column[2] = 'http://data.europa.eu/s66#name']/fct:column[3], $rows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label']/fct:column[3], $rows[fct:column[2] = 'http://purl.org/dc/terms/title']/fct:column[3])[1]"/><xsl:variable name="heading" select="string($headingTerm)"/>
     <h2 id="record-title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl"><xsl:if test="$headingTerm and not($headingTerm/@termType = 'uri') and not($headingTerm/@datatype = 'uri') and not(matches(string($headingTerm), '^https?://'))"><xsl:attribute name="property" select="string($headingTerm/../fct:column[2])"/><xsl:attribute name="content" select="string($headingTerm)"/><xsl:if test="$headingTerm/@datatype and not($headingTerm/@xml:lang or $headingTerm/@lang)"><xsl:attribute name="datatype" select="string($headingTerm/@datatype)"/></xsl:if><xsl:if test="$headingTerm/@xml:lang or $headingTerm/@lang"><xsl:attribute name="lang" select="string(($headingTerm/@xml:lang,$headingTerm/@lang)[1])"/></xsl:if></xsl:if><xsl:choose><xsl:when test="normalize-space($heading)"><xsl:value-of select="$heading"/></xsl:when><xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise></xsl:choose></h2>
     <p class="break-all text-xs text-muted-foreground" id="eu-recordorganisation-p-1">RDF resource <xsl:value-of select="$recordUri"/></p>
   </header>
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#legalName' or fct:column[2] = 'http://data.europa.eu/s66#name' or fct:column[2] = 'http://data.europa.eu/s66#vatNumber']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Overview" id="eu-recordorganisation-section-1">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordorganisation-header-2"><h3 class="text-sm font-semibold" id="eu-recordorganisation-h3-1">Overview</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordorganisation-p-2">Descriptive metadata from the current resource.</p></header>
     <dl class="divide-y divide-border" id="record-fields">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#legalName'"/><xsl:with-param name="label" select="'Legal name'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#name'"/><xsl:with-param name="label" select="'Name'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#vatNumber'"/><xsl:with-param name="label" select="'VAT identifier'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#hasSite' or fct:column[2] = 'http://data.europa.eu/s66#hasRole']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Relationships" id="eu-recordorganisation-section-2">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordorganisation-header-3"><h3 class="text-sm font-semibold" id="eu-recordorganisation-h3-2">Relationships</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordorganisation-p-3">Linked resources open through standard Maestro Record navigation.</p></header>
     <dl class="divide-y divide-border" id="eu-recordorganisation-dl-2">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#hasSite'"/><xsl:with-param name="label" select="'Sites and locations'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#hasRole'"/><xsl:with-param name="label" select="'Participant roles'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   <footer class="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" id="eu-recordorganisation-footer-1">Source: current Maestro graph server · EURIO. Validation is managed by the existing SHACL notice/report. Other predicates remain accessible through the Default Record viewer.</footer>
 </section>
</xsl:template>
<xsl:template name="RecordPerson">
 <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 text-foreground" aria-label="Researcher Record">
   <header class="space-y-3 border-b border-border pb-4" id="record-header">
     <div class="flex flex-wrap items-center justify-between gap-2" id="eu-recordperson-div-1"><span class="text-xs font-semibold uppercase tracking-wide text-primary" id="eu-recordperson-span-1">EU Data Explorer</span><span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" id="eu-recordperson-span-2">EURIO · Researcher</span></div>
     <xsl:variable name="headingTerm" select="($rows[fct:column[2] = 'http://data.europa.eu/s66#fullName']/fct:column[3], $rows[fct:column[2] = 'http://data.europa.eu/s66#name']/fct:column[3], $rows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label']/fct:column[3], $rows[fct:column[2] = 'http://purl.org/dc/terms/title']/fct:column[3])[1]"/><xsl:variable name="heading" select="string($headingTerm)"/>
     <h2 id="record-title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl"><xsl:if test="$headingTerm and not($headingTerm/@termType = 'uri') and not($headingTerm/@datatype = 'uri') and not(matches(string($headingTerm), '^https?://'))"><xsl:attribute name="property" select="string($headingTerm/../fct:column[2])"/><xsl:attribute name="content" select="string($headingTerm)"/><xsl:if test="$headingTerm/@datatype and not($headingTerm/@xml:lang or $headingTerm/@lang)"><xsl:attribute name="datatype" select="string($headingTerm/@datatype)"/></xsl:if><xsl:if test="$headingTerm/@xml:lang or $headingTerm/@lang"><xsl:attribute name="lang" select="string(($headingTerm/@xml:lang,$headingTerm/@lang)[1])"/></xsl:if></xsl:if><xsl:choose><xsl:when test="normalize-space($heading)"><xsl:value-of select="$heading"/></xsl:when><xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise></xsl:choose></h2>
     <p class="break-all text-xs text-muted-foreground" id="eu-recordperson-p-1">RDF resource <xsl:value-of select="$recordUri"/></p>
   </header>
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#fullName' or fct:column[2] = 'http://data.europa.eu/s66#firstName' or fct:column[2] = 'http://data.europa.eu/s66#lastName' or fct:column[2] = 'http://data.europa.eu/s66#identifier']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Overview" id="eu-recordperson-section-1">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordperson-header-2"><h3 class="text-sm font-semibold" id="eu-recordperson-h3-1">Overview</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordperson-p-2">Descriptive metadata from the current resource.</p></header>
     <dl class="divide-y divide-border" id="record-fields">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#fullName'"/><xsl:with-param name="label" select="'Full name'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#firstName'"/><xsl:with-param name="label" select="'Given name'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#lastName'"/><xsl:with-param name="label" select="'Family name'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#identifier'"/><xsl:with-param name="label" select="'Identifier'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#hasAffiliation' or fct:column[2] = 'http://data.europa.eu/s66#hasRole']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Relationships" id="eu-recordperson-section-2">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordperson-header-3"><h3 class="text-sm font-semibold" id="eu-recordperson-h3-2">Relationships</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordperson-p-3">Linked resources open through standard Maestro Record navigation.</p></header>
     <dl class="divide-y divide-border" id="eu-recordperson-dl-2">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#hasAffiliation'"/><xsl:with-param name="label" select="'Affiliation'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#hasRole'"/><xsl:with-param name="label" select="'Role'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   <footer class="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" id="eu-recordperson-footer-1">Source: current Maestro graph server · EURIO. Validation is managed by the existing SHACL notice/report. Other predicates remain accessible through the Default Record viewer.</footer>
 </section>
</xsl:template>
<xsl:template name="RecordGrant">
 <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 text-foreground" aria-label="Grant Record">
   <header class="space-y-3 border-b border-border pb-4" id="record-header">
     <div class="flex flex-wrap items-center justify-between gap-2" id="eu-recordgrant-div-1"><span class="text-xs font-semibold uppercase tracking-wide text-primary" id="eu-recordgrant-span-1">EU Data Explorer</span><span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" id="eu-recordgrant-span-2">EURIO · Grant</span></div>
     <xsl:variable name="headingTerm" select="($rows[fct:column[2] = 'http://data.europa.eu/s66#title']/fct:column[3], $rows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label']/fct:column[3], $rows[fct:column[2] = 'http://purl.org/dc/terms/title']/fct:column[3])[1]"/><xsl:variable name="heading" select="string($headingTerm)"/>
     <h2 id="record-title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl"><xsl:if test="$headingTerm and not($headingTerm/@termType = 'uri') and not($headingTerm/@datatype = 'uri') and not(matches(string($headingTerm), '^https?://'))"><xsl:attribute name="property" select="string($headingTerm/../fct:column[2])"/><xsl:attribute name="content" select="string($headingTerm)"/><xsl:if test="$headingTerm/@datatype and not($headingTerm/@xml:lang or $headingTerm/@lang)"><xsl:attribute name="datatype" select="string($headingTerm/@datatype)"/></xsl:if><xsl:if test="$headingTerm/@xml:lang or $headingTerm/@lang"><xsl:attribute name="lang" select="string(($headingTerm/@xml:lang,$headingTerm/@lang)[1])"/></xsl:if></xsl:if><xsl:choose><xsl:when test="normalize-space($heading)"><xsl:value-of select="$heading"/></xsl:when><xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise></xsl:choose></h2>
     <p class="break-all text-xs text-muted-foreground" id="eu-recordgrant-p-1">RDF resource <xsl:value-of select="$recordUri"/></p>
   </header>
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#identifier' or fct:column[2] = 'http://data.europa.eu/s66#title']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Overview" id="eu-recordgrant-section-1">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordgrant-header-2"><h3 class="text-sm font-semibold" id="eu-recordgrant-h3-1">Overview</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordgrant-p-2">Descriptive metadata from the current resource.</p></header>
     <dl class="divide-y divide-border" id="record-fields">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#identifier'"/><xsl:with-param name="label" select="'Identifier'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#title'"/><xsl:with-param name="label" select="'Title'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#value' or fct:column[2] = 'http://data.europa.eu/s66#hasPaymentAmount']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Funding" id="eu-recordgrant-section-2">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordgrant-header-3"><h3 class="text-sm font-semibold" id="eu-recordgrant-h3-2">Funding</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordgrant-p-3">Recorded financial and payment resources; no derived totals.</p></header>
     <dl class="divide-y divide-border" id="eu-recordgrant-dl-2">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#value'"/><xsl:with-param name="label" select="'Amount'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#hasPaymentAmount'"/><xsl:with-param name="label" select="'Payment amount'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#isFundedBy' or fct:column[2] = 'http://data.europa.eu/s66#isGrantedTo' or fct:column[2] = 'http://data.europa.eu/s66#funds']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Relationships" id="eu-recordgrant-section-3">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordgrant-header-4"><h3 class="text-sm font-semibold" id="eu-recordgrant-h3-3">Relationships</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordgrant-p-4">Linked resources open through standard Maestro Record navigation.</p></header>
     <dl class="divide-y divide-border" id="eu-recordgrant-dl-3">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#isFundedBy'"/><xsl:with-param name="label" select="'Funding source'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#isGrantedTo'"/><xsl:with-param name="label" select="'Recipient'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#funds'"/><xsl:with-param name="label" select="'Project'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   <footer class="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" id="eu-recordgrant-footer-1">Source: current Maestro graph server · EURIO. Validation is managed by the existing SHACL notice/report. Other predicates remain accessible through the Default Record viewer.</footer>
 </section>
</xsl:template>
<xsl:template name="RecordResult">
 <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 text-foreground" aria-label="Research result Record">
   <header class="space-y-3 border-b border-border pb-4" id="record-header">
     <div class="flex flex-wrap items-center justify-between gap-2" id="eu-recordresult-div-1"><span class="text-xs font-semibold uppercase tracking-wide text-primary" id="eu-recordresult-span-1">EU Data Explorer</span><span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" id="eu-recordresult-span-2">EURIO · Research result</span></div>
     <xsl:variable name="headingTerm" select="($rows[fct:column[2] = 'http://data.europa.eu/s66#title']/fct:column[3], $rows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label']/fct:column[3], $rows[fct:column[2] = 'http://purl.org/dc/terms/title']/fct:column[3])[1]"/><xsl:variable name="heading" select="string($headingTerm)"/>
     <h2 id="record-title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl"><xsl:if test="$headingTerm and not($headingTerm/@termType = 'uri') and not($headingTerm/@datatype = 'uri') and not(matches(string($headingTerm), '^https?://'))"><xsl:attribute name="property" select="string($headingTerm/../fct:column[2])"/><xsl:attribute name="content" select="string($headingTerm)"/><xsl:if test="$headingTerm/@datatype and not($headingTerm/@xml:lang or $headingTerm/@lang)"><xsl:attribute name="datatype" select="string($headingTerm/@datatype)"/></xsl:if><xsl:if test="$headingTerm/@xml:lang or $headingTerm/@lang"><xsl:attribute name="lang" select="string(($headingTerm/@xml:lang,$headingTerm/@lang)[1])"/></xsl:if></xsl:if><xsl:choose><xsl:when test="normalize-space($heading)"><xsl:value-of select="$heading"/></xsl:when><xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise></xsl:choose></h2>
     <p class="break-all text-xs text-muted-foreground" id="eu-recordresult-p-1">RDF resource <xsl:value-of select="$recordUri"/></p>
   </header>
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#title' or fct:column[2] = 'http://data.europa.eu/s66#description' or fct:column[2] = 'http://data.europa.eu/s66#doi']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Overview" id="eu-recordresult-section-1">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordresult-header-2"><h3 class="text-sm font-semibold" id="eu-recordresult-h3-1">Overview</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordresult-p-2">Descriptive metadata from the current resource.</p></header>
     <dl class="divide-y divide-border" id="record-fields">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#title'"/><xsl:with-param name="label" select="'Title'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#description'"/><xsl:with-param name="label" select="'Description'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#doi'"/><xsl:with-param name="label" select="'DOI'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#isResultOf' or fct:column[2] = 'http://data.europa.eu/s66#hasAuthor']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Relationships" id="eu-recordresult-section-2">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordresult-header-3"><h3 class="text-sm font-semibold" id="eu-recordresult-h3-2">Relationships</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordresult-p-3">Linked resources open through standard Maestro Record navigation.</p></header>
     <dl class="divide-y divide-border" id="eu-recordresult-dl-2">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#isResultOf'"/><xsl:with-param name="label" select="'Project'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#hasAuthor'"/><xsl:with-param name="label" select="'Authors'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   <footer class="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" id="eu-recordresult-footer-1">Source: current Maestro graph server · EURIO. Validation is managed by the existing SHACL notice/report. Other predicates remain accessible through the Default Record viewer.</footer>
 </section>
</xsl:template>
<xsl:template name="RecordRole">
 <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 text-foreground" aria-label="Participation role Record">
   <header class="space-y-3 border-b border-border pb-4" id="record-header">
     <div class="flex flex-wrap items-center justify-between gap-2" id="eu-recordrole-div-1"><span class="text-xs font-semibold uppercase tracking-wide text-primary" id="eu-recordrole-span-1">EU Data Explorer</span><span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" id="eu-recordrole-span-2">EURIO · Participation role</span></div>
     <xsl:variable name="headingTerm" select="($rows[fct:column[2] = 'http://data.europa.eu/s66#roleLabel']/fct:column[3], $rows[fct:column[2] = 'http://data.europa.eu/s66#title']/fct:column[3], $rows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label']/fct:column[3])[1]"/><xsl:variable name="heading" select="string($headingTerm)"/>
     <h2 id="record-title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl"><xsl:if test="$headingTerm and not($headingTerm/@termType = 'uri') and not($headingTerm/@datatype = 'uri') and not(matches(string($headingTerm), '^https?://'))"><xsl:attribute name="property" select="string($headingTerm/../fct:column[2])"/><xsl:attribute name="content" select="string($headingTerm)"/><xsl:if test="$headingTerm/@datatype and not($headingTerm/@xml:lang or $headingTerm/@lang)"><xsl:attribute name="datatype" select="string($headingTerm/@datatype)"/></xsl:if><xsl:if test="$headingTerm/@xml:lang or $headingTerm/@lang"><xsl:attribute name="lang" select="string(($headingTerm/@xml:lang,$headingTerm/@lang)[1])"/></xsl:if></xsl:if><xsl:choose><xsl:when test="normalize-space($heading)"><xsl:value-of select="$heading"/></xsl:when><xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise></xsl:choose></h2>
     <p class="break-all text-xs text-muted-foreground" id="eu-recordrole-p-1">RDF resource <xsl:value-of select="$recordUri"/></p>
   </header>
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#roleLabel']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Overview" id="eu-recordrole-section-1">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordrole-header-2"><h3 class="text-sm font-semibold" id="eu-recordrole-h3-1">Overview</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordrole-p-2">Descriptive metadata from the current resource.</p></header>
     <dl class="divide-y divide-border" id="record-fields">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#roleLabel'"/><xsl:with-param name="label" select="'Participation'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
   
    <xsl:if test="$rows[fct:column[2] = 'http://data.europa.eu/s66#isRoleOf' or fct:column[2] = 'http://data.europa.eu/s66#isInvolvedIn' or fct:column[2] = 'http://data.europa.eu/s66#isRecipientOf']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Relationships" id="eu-recordrole-section-2">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordrole-header-3"><h3 class="text-sm font-semibold" id="eu-recordrole-h3-2">Relationships</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordrole-p-3">Linked resources open through standard Maestro Record navigation.</p></header>
     <dl class="divide-y divide-border" id="eu-recordrole-dl-2">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#isRoleOf'"/><xsl:with-param name="label" select="'Organisation or person'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#isInvolvedIn'"/><xsl:with-param name="label" select="'Project'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://data.europa.eu/s66#isRecipientOf'"/><xsl:with-param name="label" select="'Grant'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   <footer class="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" id="eu-recordrole-footer-1">Source: current Maestro graph server · EURIO. Validation is managed by the existing SHACL notice/report. Other predicates remain accessible through the Default Record viewer.</footer>
 </section>
</xsl:template>
<xsl:template name="RecordDataset">
 <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 text-foreground" aria-label="Dataset Record">
   <header class="space-y-3 border-b border-border pb-4" id="record-header">
     <div class="flex flex-wrap items-center justify-between gap-2" id="eu-recorddataset-div-1"><span class="text-xs font-semibold uppercase tracking-wide text-primary" id="eu-recorddataset-span-1">EU Data Explorer</span><span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" id="eu-recorddataset-span-2">DCAT-AP · Dataset</span></div>
     <xsl:variable name="headingTerm" select="($rows[fct:column[2] = 'http://purl.org/dc/terms/title']/fct:column[3], $rows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label']/fct:column[3])[1]"/><xsl:variable name="heading" select="string($headingTerm)"/>
     <h2 id="record-title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl"><xsl:if test="$headingTerm and not($headingTerm/@termType = 'uri') and not($headingTerm/@datatype = 'uri') and not(matches(string($headingTerm), '^https?://'))"><xsl:attribute name="property" select="string($headingTerm/../fct:column[2])"/><xsl:attribute name="content" select="string($headingTerm)"/><xsl:if test="$headingTerm/@datatype and not($headingTerm/@xml:lang or $headingTerm/@lang)"><xsl:attribute name="datatype" select="string($headingTerm/@datatype)"/></xsl:if><xsl:if test="$headingTerm/@xml:lang or $headingTerm/@lang"><xsl:attribute name="lang" select="string(($headingTerm/@xml:lang,$headingTerm/@lang)[1])"/></xsl:if></xsl:if><xsl:choose><xsl:when test="normalize-space($heading)"><xsl:value-of select="$heading"/></xsl:when><xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise></xsl:choose></h2>
     <p class="break-all text-xs text-muted-foreground" id="eu-recorddataset-p-1">RDF resource <xsl:value-of select="$recordUri"/></p>
   </header>
   
    <xsl:if test="$rows[fct:column[2] = 'http://purl.org/dc/terms/description' or fct:column[2] = 'http://purl.org/dc/terms/identifier' or fct:column[2] = 'http://purl.org/dc/terms/issued' or fct:column[2] = 'http://purl.org/dc/terms/modified' or fct:column[2] = 'http://www.w3.org/ns/dcat#keyword' or fct:column[2] = 'http://purl.org/dc/terms/language']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Overview" id="eu-recorddataset-section-1">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recorddataset-header-2"><h3 class="text-sm font-semibold" id="eu-recorddataset-h3-1">Overview</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recorddataset-p-2">Descriptive metadata from the current resource.</p></header>
     <dl class="divide-y divide-border" id="record-fields">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/description'"/><xsl:with-param name="label" select="'Description'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/identifier'"/><xsl:with-param name="label" select="'Identifier'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/issued'"/><xsl:with-param name="label" select="'Issued'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/modified'"/><xsl:with-param name="label" select="'Modified'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#keyword'"/><xsl:with-param name="label" select="'Keyword'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/language'"/><xsl:with-param name="label" select="'Language'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
   
    <xsl:if test="$rows[fct:column[2] = 'http://purl.org/dc/terms/publisher' or fct:column[2] = 'http://www.w3.org/ns/dcat#distribution' or fct:column[2] = 'http://www.w3.org/ns/dcat#theme' or fct:column[2] = 'http://purl.org/dc/terms/spatial' or fct:column[2] = 'http://purl.org/dc/terms/temporal' or fct:column[2] = 'http://purl.org/dc/terms/accessRights']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Relationships" id="eu-recorddataset-section-2">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recorddataset-header-3"><h3 class="text-sm font-semibold" id="eu-recorddataset-h3-2">Relationships</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recorddataset-p-3">Linked resources open through standard Maestro Record navigation.</p></header>
     <dl class="divide-y divide-border" id="eu-recorddataset-dl-2">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/publisher'"/><xsl:with-param name="label" select="'Publisher'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#distribution'"/><xsl:with-param name="label" select="'Distributions'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#theme'"/><xsl:with-param name="label" select="'Themes'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/spatial'"/><xsl:with-param name="label" select="'Spatial coverage'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/temporal'"/><xsl:with-param name="label" select="'Temporal coverage'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/accessRights'"/><xsl:with-param name="label" select="'Access rights'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   <footer class="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" id="eu-recorddataset-footer-1">Source: current Maestro graph server · DCAT-AP. Validation is managed by the existing SHACL notice/report. Other predicates remain accessible through the Default Record viewer.</footer>
 </section>
</xsl:template>
<xsl:template name="RecordDistribution">
 <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 text-foreground" aria-label="Dataset distribution Record">
   <header class="space-y-3 border-b border-border pb-4" id="record-header">
     <div class="flex flex-wrap items-center justify-between gap-2" id="eu-recorddistribution-div-1"><span class="text-xs font-semibold uppercase tracking-wide text-primary" id="eu-recorddistribution-span-1">EU Data Explorer</span><span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" id="eu-recorddistribution-span-2">DCAT-AP · Dataset distribution</span></div>
     <xsl:variable name="headingTerm" select="($rows[fct:column[2] = 'http://purl.org/dc/terms/title']/fct:column[3], $rows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label']/fct:column[3])[1]"/><xsl:variable name="heading" select="string($headingTerm)"/>
     <h2 id="record-title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl"><xsl:if test="$headingTerm and not($headingTerm/@termType = 'uri') and not($headingTerm/@datatype = 'uri') and not(matches(string($headingTerm), '^https?://'))"><xsl:attribute name="property" select="string($headingTerm/../fct:column[2])"/><xsl:attribute name="content" select="string($headingTerm)"/><xsl:if test="$headingTerm/@datatype and not($headingTerm/@xml:lang or $headingTerm/@lang)"><xsl:attribute name="datatype" select="string($headingTerm/@datatype)"/></xsl:if><xsl:if test="$headingTerm/@xml:lang or $headingTerm/@lang"><xsl:attribute name="lang" select="string(($headingTerm/@xml:lang,$headingTerm/@lang)[1])"/></xsl:if></xsl:if><xsl:choose><xsl:when test="normalize-space($heading)"><xsl:value-of select="$heading"/></xsl:when><xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise></xsl:choose></h2>
     <p class="break-all text-xs text-muted-foreground" id="eu-recorddistribution-p-1">RDF resource <xsl:value-of select="$recordUri"/></p>
   </header>
   
    <xsl:if test="$rows[fct:column[2] = 'http://purl.org/dc/terms/description' or fct:column[2] = 'http://purl.org/dc/terms/format' or fct:column[2] = 'http://www.w3.org/ns/dcat#mediaType' or fct:column[2] = 'http://www.w3.org/ns/dcat#byteSize' or fct:column[2] = 'http://purl.org/dc/terms/modified']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Overview" id="eu-recorddistribution-section-1">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recorddistribution-header-2"><h3 class="text-sm font-semibold" id="eu-recorddistribution-h3-1">Overview</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recorddistribution-p-2">Descriptive metadata from the current resource.</p></header>
     <dl class="divide-y divide-border" id="record-fields">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/description'"/><xsl:with-param name="label" select="'Description'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/format'"/><xsl:with-param name="label" select="'Format'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#mediaType'"/><xsl:with-param name="label" select="'Media type'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#byteSize'"/><xsl:with-param name="label" select="'Size in bytes'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/modified'"/><xsl:with-param name="label" select="'Modified'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
   
    <xsl:if test="$rows[fct:column[2] = 'http://www.w3.org/ns/dcat#accessURL' or fct:column[2] = 'http://www.w3.org/ns/dcat#downloadURL' or fct:column[2] = 'http://www.w3.org/ns/dcat#accessService' or fct:column[2] = 'http://purl.org/dc/terms/license' or fct:column[2] = 'http://purl.org/dc/terms/rights']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Relationships" id="eu-recorddistribution-section-2">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recorddistribution-header-3"><h3 class="text-sm font-semibold" id="eu-recorddistribution-h3-2">Relationships</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recorddistribution-p-3">Linked resources open through standard Maestro Record navigation.</p></header>
     <dl class="divide-y divide-border" id="eu-recorddistribution-dl-2">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#accessURL'"/><xsl:with-param name="label" select="'Access URL'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#downloadURL'"/><xsl:with-param name="label" select="'Download URL'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#accessService'"/><xsl:with-param name="label" select="'Access services'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/license'"/><xsl:with-param name="label" select="'Licence'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/rights'"/><xsl:with-param name="label" select="'Rights'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   <footer class="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" id="eu-recorddistribution-footer-1">Source: current Maestro graph server · DCAT-AP. Validation is managed by the existing SHACL notice/report. Other predicates remain accessible through the Default Record viewer.</footer>
 </section>
</xsl:template>
<xsl:template name="RecordDataService">
 <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 text-foreground" aria-label="Data service Record">
   <header class="space-y-3 border-b border-border pb-4" id="record-header">
     <div class="flex flex-wrap items-center justify-between gap-2" id="eu-recorddataservice-div-1"><span class="text-xs font-semibold uppercase tracking-wide text-primary" id="eu-recorddataservice-span-1">EU Data Explorer</span><span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" id="eu-recorddataservice-span-2">DCAT-AP · Data service</span></div>
     <xsl:variable name="headingTerm" select="($rows[fct:column[2] = 'http://purl.org/dc/terms/title']/fct:column[3], $rows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label']/fct:column[3])[1]"/><xsl:variable name="heading" select="string($headingTerm)"/>
     <h2 id="record-title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl"><xsl:if test="$headingTerm and not($headingTerm/@termType = 'uri') and not($headingTerm/@datatype = 'uri') and not(matches(string($headingTerm), '^https?://'))"><xsl:attribute name="property" select="string($headingTerm/../fct:column[2])"/><xsl:attribute name="content" select="string($headingTerm)"/><xsl:if test="$headingTerm/@datatype and not($headingTerm/@xml:lang or $headingTerm/@lang)"><xsl:attribute name="datatype" select="string($headingTerm/@datatype)"/></xsl:if><xsl:if test="$headingTerm/@xml:lang or $headingTerm/@lang"><xsl:attribute name="lang" select="string(($headingTerm/@xml:lang,$headingTerm/@lang)[1])"/></xsl:if></xsl:if><xsl:choose><xsl:when test="normalize-space($heading)"><xsl:value-of select="$heading"/></xsl:when><xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise></xsl:choose></h2>
     <p class="break-all text-xs text-muted-foreground" id="eu-recorddataservice-p-1">RDF resource <xsl:value-of select="$recordUri"/></p>
   </header>
   
    <xsl:if test="$rows[fct:column[2] = 'http://purl.org/dc/terms/description' or fct:column[2] = 'http://purl.org/dc/terms/identifier']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Overview" id="eu-recorddataservice-section-1">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recorddataservice-header-2"><h3 class="text-sm font-semibold" id="eu-recorddataservice-h3-1">Overview</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recorddataservice-p-2">Descriptive metadata from the current resource.</p></header>
     <dl class="divide-y divide-border" id="record-fields">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/description'"/><xsl:with-param name="label" select="'Description'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/identifier'"/><xsl:with-param name="label" select="'Identifier'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
   
    <xsl:if test="$rows[fct:column[2] = 'http://www.w3.org/ns/dcat#endpointURL' or fct:column[2] = 'http://www.w3.org/ns/dcat#endpointDescription' or fct:column[2] = 'http://www.w3.org/ns/dcat#servesDataset' or fct:column[2] = 'http://purl.org/dc/terms/accessRights']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Relationships" id="eu-recorddataservice-section-2">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recorddataservice-header-3"><h3 class="text-sm font-semibold" id="eu-recorddataservice-h3-2">Relationships</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recorddataservice-p-3">Linked resources open through standard Maestro Record navigation.</p></header>
     <dl class="divide-y divide-border" id="eu-recorddataservice-dl-2">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#endpointURL'"/><xsl:with-param name="label" select="'Endpoint URL'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#endpointDescription'"/><xsl:with-param name="label" select="'Endpoint description'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#servesDataset'"/><xsl:with-param name="label" select="'Served datasets'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/accessRights'"/><xsl:with-param name="label" select="'Access rights'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   <footer class="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" id="eu-recorddataservice-footer-1">Source: current Maestro graph server · DCAT-AP. Validation is managed by the existing SHACL notice/report. Other predicates remain accessible through the Default Record viewer.</footer>
 </section>
</xsl:template>
<xsl:template name="RecordCatalog">
 <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 text-foreground" aria-label="Data catalogue Record">
   <header class="space-y-3 border-b border-border pb-4" id="record-header">
     <div class="flex flex-wrap items-center justify-between gap-2" id="eu-recordcatalog-div-1"><span class="text-xs font-semibold uppercase tracking-wide text-primary" id="eu-recordcatalog-span-1">EU Data Explorer</span><span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" id="eu-recordcatalog-span-2">DCAT-AP · Data catalogue</span></div>
     <xsl:variable name="headingTerm" select="($rows[fct:column[2] = 'http://purl.org/dc/terms/title']/fct:column[3], $rows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label']/fct:column[3])[1]"/><xsl:variable name="heading" select="string($headingTerm)"/>
     <h2 id="record-title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl"><xsl:if test="$headingTerm and not($headingTerm/@termType = 'uri') and not($headingTerm/@datatype = 'uri') and not(matches(string($headingTerm), '^https?://'))"><xsl:attribute name="property" select="string($headingTerm/../fct:column[2])"/><xsl:attribute name="content" select="string($headingTerm)"/><xsl:if test="$headingTerm/@datatype and not($headingTerm/@xml:lang or $headingTerm/@lang)"><xsl:attribute name="datatype" select="string($headingTerm/@datatype)"/></xsl:if><xsl:if test="$headingTerm/@xml:lang or $headingTerm/@lang"><xsl:attribute name="lang" select="string(($headingTerm/@xml:lang,$headingTerm/@lang)[1])"/></xsl:if></xsl:if><xsl:choose><xsl:when test="normalize-space($heading)"><xsl:value-of select="$heading"/></xsl:when><xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise></xsl:choose></h2>
     <p class="break-all text-xs text-muted-foreground" id="eu-recordcatalog-p-1">RDF resource <xsl:value-of select="$recordUri"/></p>
   </header>
   
    <xsl:if test="$rows[fct:column[2] = 'http://purl.org/dc/terms/description' or fct:column[2] = 'http://purl.org/dc/terms/issued' or fct:column[2] = 'http://purl.org/dc/terms/modified' or fct:column[2] = 'http://purl.org/dc/terms/language']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Overview" id="eu-recordcatalog-section-1">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordcatalog-header-2"><h3 class="text-sm font-semibold" id="eu-recordcatalog-h3-1">Overview</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordcatalog-p-2">Descriptive metadata from the current resource.</p></header>
     <dl class="divide-y divide-border" id="record-fields">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/description'"/><xsl:with-param name="label" select="'Description'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/issued'"/><xsl:with-param name="label" select="'Issued'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/modified'"/><xsl:with-param name="label" select="'Modified'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/language'"/><xsl:with-param name="label" select="'Language'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
   
    <xsl:if test="$rows[fct:column[2] = 'http://purl.org/dc/terms/publisher' or fct:column[2] = 'http://www.w3.org/ns/dcat#dataset' or fct:column[2] = 'http://www.w3.org/ns/dcat#service' or fct:column[2] = 'http://xmlns.com/foaf/0.1/homepage' or fct:column[2] = 'http://www.w3.org/ns/dcat#themeTaxonomy']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Relationships" id="eu-recordcatalog-section-2">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordcatalog-header-3"><h3 class="text-sm font-semibold" id="eu-recordcatalog-h3-2">Relationships</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordcatalog-p-3">Linked resources open through standard Maestro Record navigation.</p></header>
     <dl class="divide-y divide-border" id="eu-recordcatalog-dl-2">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/publisher'"/><xsl:with-param name="label" select="'Publisher'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#dataset'"/><xsl:with-param name="label" select="'Datasets'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#service'"/><xsl:with-param name="label" select="'Services'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://xmlns.com/foaf/0.1/homepage'"/><xsl:with-param name="label" select="'Homepage'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://www.w3.org/ns/dcat#themeTaxonomy'"/><xsl:with-param name="label" select="'Themes'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   <footer class="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" id="eu-recordcatalog-footer-1">Source: current Maestro graph server · DCAT-AP. Validation is managed by the existing SHACL notice/report. Other predicates remain accessible through the Default Record viewer.</footer>
 </section>
</xsl:template>
<xsl:template name="RecordCatalogRecord">
 <section xmlns:mui="gttp://ggg.maestro.ecosys/ns/ui#" mui:framework="next@^16.4.0" id="maestro-record-viewer" about="{$recordUri}" class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-2 text-foreground" aria-label="Catalogue record Record">
   <header class="space-y-3 border-b border-border pb-4" id="record-header">
     <div class="flex flex-wrap items-center justify-between gap-2" id="eu-recordcatalogrecord-div-1"><span class="text-xs font-semibold uppercase tracking-wide text-primary" id="eu-recordcatalogrecord-span-1">EU Data Explorer</span><span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" id="eu-recordcatalogrecord-span-2">DCAT-AP · Catalogue record</span></div>
     <xsl:variable name="headingTerm" select="($rows[fct:column[2] = 'http://purl.org/dc/terms/title']/fct:column[3], $rows[fct:column[2] = 'http://www.w3.org/2000/01/rdf-schema#label']/fct:column[3])[1]"/><xsl:variable name="heading" select="string($headingTerm)"/>
     <h2 id="record-title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl"><xsl:if test="$headingTerm and not($headingTerm/@termType = 'uri') and not($headingTerm/@datatype = 'uri') and not(matches(string($headingTerm), '^https?://'))"><xsl:attribute name="property" select="string($headingTerm/../fct:column[2])"/><xsl:attribute name="content" select="string($headingTerm)"/><xsl:if test="$headingTerm/@datatype and not($headingTerm/@xml:lang or $headingTerm/@lang)"><xsl:attribute name="datatype" select="string($headingTerm/@datatype)"/></xsl:if><xsl:if test="$headingTerm/@xml:lang or $headingTerm/@lang"><xsl:attribute name="lang" select="string(($headingTerm/@xml:lang,$headingTerm/@lang)[1])"/></xsl:if></xsl:if><xsl:choose><xsl:when test="normalize-space($heading)"><xsl:value-of select="$heading"/></xsl:when><xsl:otherwise><xsl:value-of select="$recordUri"/></xsl:otherwise></xsl:choose></h2>
     <p class="break-all text-xs text-muted-foreground" id="eu-recordcatalogrecord-p-1">RDF resource <xsl:value-of select="$recordUri"/></p>
   </header>
   
    <xsl:if test="$rows[fct:column[2] = 'http://purl.org/dc/terms/description' or fct:column[2] = 'http://purl.org/dc/terms/issued' or fct:column[2] = 'http://purl.org/dc/terms/modified']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Overview" id="eu-recordcatalogrecord-section-1">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordcatalogrecord-header-2"><h3 class="text-sm font-semibold" id="eu-recordcatalogrecord-h3-1">Overview</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordcatalogrecord-p-2">Descriptive metadata from the current resource.</p></header>
     <dl class="divide-y divide-border" id="record-fields">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/description'"/><xsl:with-param name="label" select="'Description'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/issued'"/><xsl:with-param name="label" select="'Issued'"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/modified'"/><xsl:with-param name="label" select="'Modified'"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   
   
    <xsl:if test="$rows[fct:column[2] = 'http://xmlns.com/foaf/0.1/primaryTopic' or fct:column[2] = 'http://purl.org/dc/terms/conformsTo']">
    <section class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground" aria-label="Relationships" id="eu-recordcatalogrecord-section-2">
     <header class="border-b border-border bg-muted/30 px-4 py-3" id="eu-recordcatalogrecord-header-3"><h3 class="text-sm font-semibold" id="eu-recordcatalogrecord-h3-2">Relationships</h3><p class="mt-1 text-xs text-muted-foreground" id="eu-recordcatalogrecord-p-3">Linked resources open through standard Maestro Record navigation.</p></header>
     <dl class="divide-y divide-border" id="eu-recordcatalogrecord-dl-2">
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://xmlns.com/foaf/0.1/primaryTopic'"/><xsl:with-param name="label" select="'Primary topic'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
      <xsl:call-template name="property-row"><xsl:with-param name="iri" select="'http://purl.org/dc/terms/conformsTo'"/><xsl:with-param name="label" select="'Conforms to'"/><xsl:with-param name="relationship" select="true()"/></xsl:call-template>
     </dl>
    </section>
    </xsl:if>
   <footer class="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" id="eu-recordcatalogrecord-footer-1">Source: current Maestro graph server · DCAT-AP. Validation is managed by the existing SHACL notice/report. Other predicates remain accessible through the Default Record viewer.</footer>
 </section>
</xsl:template>
</xsl:stylesheet>
