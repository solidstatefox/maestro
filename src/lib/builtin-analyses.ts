// Trusted local Analysis definitions. Keep the bundled XSLT identical to graph/maestro-analyze.ttl.
import type { AnalysisProvider } from "./personal-sparql-reads";
export const BUILTIN_ANALYSES: readonly AnalysisProvider[] = [
  {
    "uri": "gttp://ggg.maestro.ecosys/analyze/table",
    "label": "Table",
    "icon": "table-2",
    "order": 1,
    "stylesheet": "<xsl:stylesheet version=\"3.0\" xmlns:xsl=\"http://www.w3.org/1999/XSL/Transform\" xmlns:m=\"gttp://ggg.maestro.ecosys/ns/xslt/context#\" exclude-result-prefixes=\"m\">\n  <xsl:output method=\"xml\" omit-xml-declaration=\"yes\"/>\n  <xsl:template match=\"/m:context\">\n    <analysis kind=\"table\" trail-style=\"font-weight: 500;\" table-style=\"font-size: 12px; line-height: 1.25;\" header-style=\"padding: 4px 6px; vertical-align: top; font-weight: 600;\" cell-style=\"padding: 3px 6px; vertical-align: top;\" row-style=\"line-height: 1.25;\" badge-style=\"background-color: transparent; color: inherit; border-radius: 0; padding: 1px 2px; line-height: 1.2;\">\n      <columns>\n        <!-- Maestro renders the live breadcrumb trail above the canvas.\n             Table data columns reference only direct children of the view carrier. -->\n        <column kind=\"result\" label=\"Results\" header-style=\"padding: 4px 6px;\"/>\n        <xsl:for-each select=\"m:breadcrumbs/m:breadcrumb\">\n          <column kind=\"breadcrumb\" node-id=\"{@id}\" label=\"{@label}\" breadcrumb-style=\"font-weight: 500;\" header-style=\"padding: 4px 6px;\"/>\n        </xsl:for-each>\n      </columns>\n      <rows><xsl:for-each select=\"m:results/m:result\">\n        <xsl:variable name=\"res\" select=\".\"/>\n        <row uri=\"{@uri}\" label=\"{@label}\">\n          <xsl:for-each select=\"/m:context/m:breadcrumbs/m:breadcrumb\">\n            <xsl:variable name=\"iri\" select=\"string(@iri)\"/>\n            <xsl:variable name=\"direction\" select=\"string(@direction)\"/>\n            <xsl:variable name=\"anchor\" select=\"string(@anchor-id)\"/>\n            <cell cell-style=\"padding: 3px 6px;\"><xsl:for-each select=\"$res/m:value[if ($anchor) then @node-id=$anchor else @property=$iri and @direction=$direction]\">\n              <value><xsl:value-of select=\".\"/></value>\n            </xsl:for-each></cell>\n          </xsl:for-each>\n        </row>\n      </xsl:for-each></rows>\n    </analysis>\n  </xsl:template>\n</xsl:stylesheet>"
  },
  {
    "uri": "gttp://ggg.maestro.ecosys/analyze/compare-table",
    "label": "Compare Table",
    "icon": "table-properties",
    "order": 2,
    "stylesheet": "<xsl:stylesheet version=\"3.0\" xmlns:xsl=\"http://www.w3.org/1999/XSL/Transform\" xmlns:m=\"gttp://ggg.maestro.ecosys/ns/xslt/context#\" exclude-result-prefixes=\"m\">\n  <xsl:output method=\"xml\" omit-xml-declaration=\"yes\"/>\n  <xsl:template match=\"/m:context\">\n    <xsl:variable name=\"facet\" select=\"string(m:selection/@facet)\"/>\n    <xsl:variable name=\"direction\" select=\"string(m:selection/@direction)\"/>\n    <xsl:variable name=\"anchor\" select=\"string(m:selection/@node-id)\"/>\n    <xsl:variable name=\"values\" select=\"distinct-values(m:results/m:result/m:value[if ($anchor) then @node-id=$anchor else @property=$facet and @direction=$direction]/string())\"/>\n    <analysis kind=\"compare\" table-style=\"font-size: 12px; line-height: 1.25;\" header-style=\"padding: 4px 6px;\" cell-style=\"padding: 3px 6px;\" row-style=\"line-height: 1.25;\">\n      <columns><column kind=\"result\" label=\"Result\"/>\n        <xsl:for-each select=\"$values[position() le 60]\"><column kind=\"value\" label=\"{.}\"/></xsl:for-each>\n      </columns>\n      <rows><xsl:for-each select=\"m:results/m:result\">\n        <xsl:variable name=\"res\" select=\".\"/>\n        <row uri=\"{@uri}\" label=\"{@label}\">\n          <xsl:for-each select=\"$values[position() le 60]\">\n            <xsl:variable name=\"v\" select=\".\"/>\n            <cell checked=\"{if ($res/m:value[(if ($anchor) then @node-id=$anchor else @property=$facet and @direction=$direction) and string(.)=$v]) then 'yes' else 'no'}\"/>\n          </xsl:for-each>\n        </row>\n      </xsl:for-each></rows>\n    </analysis>\n  </xsl:template>\n</xsl:stylesheet>"
  }
];
export const BUILTIN_ANALYSIS_URIS = new Set(BUILTIN_ANALYSES.map(item => item.uri));
export const COMPARE_TABLE_URI = BUILTIN_ANALYSES[1].uri;

/** Merge independently verified lanes; conflicting definitions fail closed. */
export function mergeAnalysisDiscoveryItems(...lanes: readonly (readonly AnalysisProvider[])[]): AnalysisProvider[] {
  const byUri = new Map<string, AnalysisProvider>();
  const conflicts = new Set<string>();
  for (const lane of lanes) for (const item of lane) {
    if (BUILTIN_ANALYSIS_URIS.has(item.uri)) continue;
    const previous = byUri.get(item.uri);
    if (previous && JSON.stringify(previous) !== JSON.stringify(item)) conflicts.add(item.uri);
    else byUri.set(item.uri, item);
  }
  return [...byUri.values()].filter(item => !conflicts.has(item.uri)).sort((a,b)=>a.order-b.order || a.label.localeCompare(b.label));
}
