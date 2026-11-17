"""Offline architecture/seed regression checks for Maestro's source-only ZIP.
Run: python tests/maestro-regression-static.py
Does NOT replace npm.cmd run build, browser tests, or an authenticated Virtuoso session.
"""
from pathlib import Path
from hashlib import sha256
import json, re

ROOT=Path(__file__).resolve().parents[1]
source=lambda path:(ROOT/path).read_text(encoding='utf-8')

def assert_true(condition, description):
    assert condition, description
    print('PASS', description)

routes=sorted(p.relative_to(ROOT/'src/app/proxy/api').as_posix() for p in (ROOT/'src/app/proxy/api').rglob('route.ts'))
assert_true(routes==['fct/route.ts','observations/route.ts','service/route.ts','sparql/route.ts'], 'exactly four runtime proxy API routes')
assert_true(not any('/graph/' in str(p) for p in (ROOT/'src/app/proxy/api').rglob('route.ts')),'no server-side graph-seed route')
manifest=json.loads(source('graph/manifest.json'))
assert_true(len(manifest)==27,'27 manifest RDF documents')
assert_true(not (ROOT/'graph/kinds/provider.json').exists(),'generated graph/kinds/provider.json absent')
assert_true(sorted(str(p.relative_to(ROOT/'graph')) for p in (ROOT/'graph').rglob('*.json'))==['manifest.json'],'no compiled JSON provider registries under /graph')
entries=json.loads(source('public/maestro-seed/manifest.json'))
assert_true({e['file']:e['destination'] for e in entries}==manifest,'precompiled browser seeding uses all authoritative manifest destinations')
assert_true(len(entries)==len({e['asset'] for e in entries}),'unique asset for each RDF document')
total=0
for e in entries:
    asset=json.loads(source('public/maestro-seed/'+e['asset']))
    rdf=(ROOT/'graph'/e['file']).read_bytes()
    assert asset['file']==e['file'] and asset['destination']==e['destination'],e['file']
    assert asset['digest']=='sha256:'+sha256(rdf).hexdigest(),e['file']
    assert isinstance(asset['triples'],list),e['file']
    for t in asset['triples']:
        assert t['subject']['termType'] in ('NamedNode','BlankNode'),e['file']
        assert t['predicate']['termType']=='NamedNode',e['file']
        assert t['object']['termType'] in ('NamedNode','BlankNode','Literal'),e['file']
    total+=len(asset['triples'])
assert_true(total>2000,f'{total} RDF triples compiled into static browser assets')
seed=source('src/lib/client-graph-seed.ts')
assert_true('personalContext()' in seed and 'updatePersonal(' in seed and '/maestro-seed/' in seed,'login seeding operates via personal context and existing SPARQL transport')
assert_true('CLEAR SILENT GRAPH' in seed and 'INSERT DATA' in seed,'browser controls RDF writes into personal named graphs')
assert_true('LOAD <http://localhost' not in seed and 'waitForPersonalGraphSeed' not in source('src/lib/personal-sparql.ts'), 'no Virtuoso localhost LOAD or host-side seeding')
assert_true('seedPersonalGraphs()' in source('src/canvas/controllers/authentication.ts'), 'successful user login calls browser seeding')
assert_true('graph/kinds/provider.json' not in source('src/lib/maestro-kinds.ts'), 'Kinds runtime does not import removed generated JSON')
assert_true('selectPersonal(query, ctx, signal)' in source('src/lib/client-kinds.ts'),'Kinds regexes discovered via direct authenticated SPARQL')
assert_true('if (isSearching)' in source('src/canvas/utils/workspace-controller.tsx'),'Providers catalog waits for FCT results, not optional FSM approvals')
assert_true('returnToPreviousContext()' in source('src/canvas/utils/workspace-controller.tsx') and 'BROWSE_QUERY_DISPLACED' in source('src/lib/app-lifecycle/operations.ts'),'Return to Browse uses navigation actor ownership')
assert_true('setSelectedUri(row.uri); }}' in source('src/canvas/tab/analyze/page.tsx'),'Analyze Record selection does not force Browse tab')
assert_true('const filteredValues = fetchedValues;' in source('src/canvas/left/filter.tsx'),'Personal facet does not discard server FCT rows through a duplicate typed-term filter')
assert_true('children = [node("provider-transcoder-type", "class", `${OTC}Transcoder`), view]' in source('src/lib/provider-fct-query.ts'),'Transcoders FCT registry uses native rdf:type without unnecessary reverse-role projection')
assert_true('basis-[30ch]' in source('src/canvas/top/appbar-pane.tsx'), 'graph selector target based on average of 39 bundled labels')
assert_true('No common values were returned. Try narrowing' in source('src/canvas/tab/view/overview.tsx'),'Common Values empty state offers filter guidance')
# Follow-up acceptance guards. They are structural, not substitutes for browser tests.
input_group = source('src/canvas/utils/workspace-controller.tsx').split('  const searchInputGroup = (',1)[1].split('  // Analyze Table projects',1)[0]
assert_true(input_group.count('<InputGroup ') == 1, 'root editor uses exactly one InputGroup outer boundary')
assert_true('align="inline-start"' in input_group and 'align="inline-end"' in input_group,
            'URI globe, label selector and signals occupy InputGroup addons')
assert_true('<InputGroupButton' in input_group and 'signalPickerExpanded' in input_group,
            'five signal buttons are nested inside the root InputGroup')
render = source('src/canvas/top/breadcrumb-renderers.tsx')
assert_true('readRootHoverDelayMs' in render and '}, hoverDelayMs)' in render,
            'root hover reads the Sheet-configurable dwell interval')
settings = source('src/canvas/sheet/settings-pane.tsx')
assert_true('writeRootHoverDelayMs(value)' in settings and 'maestro-root-hover-delay' in settings,
            'Sheet stores root editor hover delay')
assert_true('<Slider id="maestro-uri-complete-timeout"' in settings and 'disabled={masterTimeoutEnabled}' in settings,
            'autocomplete timeout uses master-controlled Slider')
assert_true('effectiveAutocompleteTimeout' in settings and 'writeUriAutocompleteSettings(updated)' in settings,
            'master timeout persists autocomplete timeout')
query = source('src/lib/uri-autocomplete-query.ts')
route = source('src/app/proxy/api/sparql/route.ts')
assert_true('FILTER(CONTAINS(LCASE(STR(?label))' in query and 'LIMIT ${limit}' in query,
            'URI autocomplete uses bounded case-insensitive substring matching')
assert_true(r'!/\bCONTAINS' in route and 'requestClass === "autocomplete"' in route,
            'priority SPARQL validator accepts the bounded autocomplete lookup shape')
assert_true('"autocomplete"' in source('src/lib/graph-server-query-scheduler.ts') and
            'autocomplete: -1' in source('src/lib/graph-server-query-scheduler.ts'),
            'autocomplete receives priority over queued interactive/facet/count work')
assert_true('RIBBON_ENTRY_FROM_BROWSE' in source('src/lib/app-lifecycle/operations.ts') and
            'type: "RIBBON_ENTRY_FROM_BROWSE"' in source('src/canvas/utils/workspace-controller.tsx'),
            'Return is captured on Browse -> ribbon entry, not only Provider query replacement')
nav = source('src/canvas/top/appbar-pane.tsx')
assert_true('variant="ghost" size="icon" onMouseEnter={() => startHistoryActionHover("backward")}' in nav and
            'variant="ghost" size="icon" onMouseEnter={() => startHistoryActionHover("forward")}' in nav,
            'History navigation icons use borderless standard shadcn ghost Buttons')
assert_true('aria-label="Current query bookmark"' in nav and '<ToggleGroup' not in nav,
            'Bookmark and pinned appbar buttons share shadcn ButtonGroup patterns')
# The old Browse toolbar must not be revised as part of this remaining-work patch.
old_toolbar = source('src/canvas/center/pane.tsx')
# The 3798-byte block is intentionally immune to future toolbar restyles.
legacy_marker = '                  <ButtonGroup\n                    aria-label="Results, badges, and query inspector"'
legacy_close = '                  </ButtonGroup>'
legacy_start = old_toolbar.index(legacy_marker)
legacy_end = old_toolbar.index(legacy_close, legacy_start) + len(legacy_close)
assert_true(sha256(old_toolbar[legacy_start:legacy_end].encode('utf-8')).hexdigest() ==
            '7fdb8dee3c44f2c82616a28c94c2f06bd74024d9e55ba0b3345b04896815af76',
            'Browse toolbar JSX is byte-identical to the old working implementation')
assert_true('className="hidden shrink-0 items-center [&>*+*]:border-l [&>*+*]:border-input group-hover/header:inline-flex"' in old_toolbar,
            'Browse toolbar retains exact legacy hover-only class composition')
print('Static regression suite completed; runtime and TypeScript type checks remain necessary.')
