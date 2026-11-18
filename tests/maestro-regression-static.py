"""Source-only architectural checks for Maestro.

Run as an optional Python test (Node/tsx tests do not require Python). Generated
assets are verified when present, after the normal build seed preparation step.
"""
from pathlib import Path
from hashlib import sha256
import json
import re

ROOT = Path(__file__).resolve().parents[1]
read = lambda relative: (ROOT / relative).read_text(encoding='utf-8')

def check(condition, description):
    assert condition, description
    print('PASS', description)

routes = sorted(p.relative_to(ROOT/'src/app/proxy/api').as_posix()
                for p in (ROOT/'src/app/proxy/api').rglob('route.ts'))
check(routes == ['fct/route.ts','observations/route.ts','service/route.ts','sparql/route.ts'],
      'exactly four proxy routes')
manifest = json.loads(read('graph/manifest.json'))
check(bool(manifest) and len(manifest)==len(set(manifest)), 'unique RDF seed manifest entries')
for file, destination in manifest.items():
    check((ROOT/'graph'/file).is_file() and isinstance(destination, str) and destination,
          f'graph seed source and destination: {file}')
check(not (ROOT/'graph/kinds/provider.json').exists(), 'no generated Kinds JSON provider')
check(sorted(str(p.relative_to(ROOT/'graph')) for p in (ROOT/'graph').rglob('*.json'))==['manifest.json'],
      'RDF graph manifests remain the source of provider definitions')

compiled = ROOT/'public/maestro-seed/manifest.json'
if compiled.exists():
    entries=json.loads(compiled.read_text(encoding='utf-8'))
    check({e['file']:e['destination'] for e in entries} == manifest,
          'compiled browser seed destinations match the authoritative RDF manifest')
    for entry in entries:
        asset=json.loads(read('public/maestro-seed/'+entry['asset']))
        check(asset['digest']=='sha256:'+sha256((ROOT/'graph'/entry['file']).read_bytes()).hexdigest(),
              f'compiled RDF seed digest: {entry["file"]}')
else:
    print('SKIP static RDF asset validation (prebuild seed generation has not run)')

seed=read('src/lib/client-graph-seed.ts')
check('personalContext()' in seed and 'updatePersonal(' in seed and '/maestro-seed/' in seed,
      'browser graph seeding uses the authenticated SPARQL transport')
check('seedPersonalGraphs()' in read('src/canvas/controllers/authentication.ts'),
      'successful login initiates personal graph seeding')
check('SELECT DISTINCT ?provider ?kind ?pattern' in read('src/lib/client-kinds.ts'),
      'Kinds are discovered through provider RDF, not a TypeScript registry')
check('RIBBON_ENTRY_FROM_BROWSE' in read('src/lib/app-lifecycle/operations.ts'),
      'Browse return context remains XState-owned')
check('createMachine' in read('src/lib/app-lifecycle/root-breadcrumb.ts'),
      'root breadcrumb uses the XState controller')
check('const searchInputGroup = (' in read('src/canvas/utils/workspace-controller.tsx'),
      'root breadcrumb shares one editor')
check('bif:contains' in read('src/lib/uri-autocomplete-query.ts') and
      'ORDER BY DESC (<LONG::IRI_RANK>' in read('src/lib/uri-autocomplete-query.ts'),
      'root autocomplete uses its existing indexed ranked SPARQL query')
check('const { clean, graphs, hasImplicitGraph } = inspectPersonalUpdateGraphs(update)' in
      read('src/app/proxy/api/sparql/route.ts'),
      'personal SPARQL Update graph authorization ignores embedded query literals')
check('machine?.targetClasses instanceof Set' in read('src/lib/client-status-reads.ts'),
      'Record status projection rejects malformed machine definitions safely')
check('state: "preparing" | "queued" | "active"' in read('src/lib/client-query-cache.ts'),
      'proxy request preparation is not mislabeled as a queued request')
check('"test": "node tools/run-tests.mjs"' in read('package.json') and
      'npm run test' in read('package.json'),
      'production build gates on the complete Node/TypeScript test suite')
print('Maestro static source checks passed.')
