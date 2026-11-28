/** Regression contracts for the source-only Maestro TODO consolidation.
 * These are structural tests, NOT authenticated UI/Virtuoso acceptance tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const check = (label, file, ...patterns) => test(label, () => {
  const code=read(file);
  for (const pattern of patterns) assert.match(code,pattern, `${file} missing ${pattern}`);
});
check('Browse bottom toolbar is always visible, with no parent-hover-only visibility', 'src/canvas/center/pane.tsx', /className="inline-flex min-w-0 shrink-0 items-center/, /ButtonGroup/);
check('Selected categories use the normal label processor', 'src/canvas/left/filter-pane.tsx', /toLabel\(item\.uri,\s*"Class"\)/);
check('Root crumb retains a Sheet-configured hovering state', 'src/lib/app-lifecycle/root-breadcrumb.ts', /hovering:\s*\{/, /rootHoverDelay:\s*\{/, /target:\s*"editing"/);
check('Root crumb focus does not preempt navigation button', 'src/canvas/top/breadcrumb-renderers.tsx', /matches\('input, textarea, \[contenteditable="true"\]'\)/);
check('Root scope superscript is visible in expanded and collapsed states', 'src/canvas/top/breadcrumb-renderers.tsx', /rootClassLabels\.length > 0 && <span/, /\{rootSearchExpanded \? searchInputGroup/);
check('Root input is contained within parent border', 'src/canvas/top/breadcrumb-renderers.tsx', /relative isolate h-10 min-w-0 box-border/);
check('Signal click persists mode before closing picker', 'src/canvas/top/breadcrumb-renderers.tsx', /setTextSearchMode\(mode\);\s*rootBreadcrumb\.send\(\{ type: "SIGNAL_SELECTED" \}\)/);
check('View diagnostics use portaled centered collision-aware Base UI menu', 'src/canvas/top/view-diagnostics-hover.tsx', /@base-ui\/react\/menu/, /Menu\.Portal/, /align="center"/, /collisionPadding=\{12\}/);
check('View defaults to Perspectives', 'src/canvas/controllers/view.ts', /"perspectives"/);
check('View selection auto activation is XState-gated', 'src/lib/app-lifecycle/perspective-selection.ts', /RIBBON_OBSERVED/, /AUTO_APPLIED/, /selected:\s*\{/);
check('View retains selected personal perspective only in its validated unchanged query scope', 'src/canvas/utils/workspace-controller.tsx', /personalPerspectiveMatchesQuery\(selectedViewUri, queryTree\) && retainedSelectedViewRef/, /retentionKey = JSON\.stringify\(\[queryXml, accessSessionKey/);
check('Tags discover without waiting for datatype probing', 'src/lib/client-facet-providers.ts', /const tagDiscovery/, /onTags\?\.\(ready\)/, /const tags = await tagDiscovery/);
check('Tags have an independent XState discovery response', 'src/lib/app-lifecycle/providers.ts', /DISCOVERY_TAGS_RESOLVED/, /matches: \{ \.\.\.context\.matches, tags: event\.tags \}/);
check('Tag cloud shows an explicit loading/empty state', 'src/canvas/left/personal-tag-cloud.tsx', /Loading tags/, /No tag values/);
check('Spider validates raw values then normalizes each axis', 'graph/spider/provider.ttl', /p:finite/, /min\(\$values\)/, /<cell raw=/);
check('Spider radial axis uses percent; tooltips display actual numeric values', 'src/canvas/tab/analyze/page-provider.tsx', /domain=\{\[0, 100\]\}/, /raw_\$\{String\(item\.dataKey\)\}/);
check('View badge uses approval count from XState', 'src/canvas/top/appbar-pane.tsx', /selectPendingApprovalBadge/, /pendingBadge\.total/);
check('Saved View selection is preserved in share URL', 'src/canvas/utils/workspace-controller.tsx', /params\.set\("ribbonButton"/, /restoredViewSelection\.selectedViewUri = restored\.selectedViewUri/, /navigateQueryView\(restoredViewSelection\)/);
check('Configure Properties and Roles inspectors expose six actual XML/SPARQL tabs and execute read-only SPARQL',
  'src/canvas/left/configure-pane.tsx',
  /function configureKindsInspectorTabs\(tree: FctQueryTree, direction: "property" \| "role"\)/,
  /sourceXml = serializeFctQuery\(tree\)/,
  /buildFctKindAvailabilitySparql\(tree, direction\)/,
  /function configureInspectorTabs\(tree: FctQueryTree, valuesXml: string, direction: "property" \| "role"/,
  /compileFctXmlToSparql\(valuesXml\)\.query/,
  /createDistinctCountQuery\(tree, direction, firstIri/,
  /buildFctCountSparql\(countTree\)/,
  /label: "Kinds XML"/, /label: "Kinds SPARQL"/,
  /label: "Count XML \(first predicate\)"/,
  /label: "Count SPARQL \(first predicate\)"/,
  /configureInspectorTabs\(queryTree, queryWithoutPagingXml\(FCT_VIEW_TYPES\.PROPERTIES\), "property"/,
  /configureInspectorTabs\(queryTree, queryWithoutPagingXml\(FCT_VIEW_TYPES\.PROPERTIES_IN\), "role"/,
  /primaryTabLabel="Properties XML"/,
  /primaryTabLabel="Roles XML"/);
check('Configure inspectors use the existing read-only SPARQL proxy and provide Execute for SPARQL tabs',
  'src/canvas/utils/query-inspector.tsx',
  /attributedSparqlFetch\("\/proxy\/api\/sparql"/,
  /method: "POST"/,
  /displayedLanguage !== "sparql"/,
  /onClick=\{\(\) => void execute\(\)\}/,
  /displayedLanguage === "sparql" && displayedExecutionAddr/);
check('Record query inspector exposes honest Kinds scope XML and classification SPARQL preview',
  'src/canvas/right/pane.tsx',
  /recordKindsScopeXml/, /buildRecordKindsInspectorSparql\(/,
  /label: "Kinds XML"/, /label: "Kinds SPARQL"/);
check('Record Kinds preview distinguishes local classification from an upstream request',
  'src/lib/record-kinds-inspector.ts',
  /Record Kinds are classified locally/, /MAESTRO_KIND_IDS/, /maestroKindSparql\(kind, value\)/,
  /FILTER \(\?maestroKind =/);
