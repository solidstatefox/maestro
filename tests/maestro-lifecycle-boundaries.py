"""Cross-platform static checks for the Status-access/seeding/navigation regressions.
These tests are source-level architecture guards, not browser/Virtuoso acceptance.
Run: python tests/maestro-lifecycle-boundaries.py
"""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def get(p):return (ROOT/p).read_text(encoding='utf-8')
def check(cond,msg):
    assert cond,msg
    print('PASS',msg)

access=get('src/lib/app-lifecycle/access.ts')
controller=get('src/canvas/utils/workspace-controller.tsx')
auth=get('src/canvas/controllers/authentication.ts')
seed=get('src/lib/client-graph-seed.ts')
sparql=get('src/app/proxy/api/sparql/route.ts')
fct=get('src/app/proxy/api/fct/route.ts')
providers=get('src/lib/provider-catalog-items.ts')
appbar=get('src/canvas/top/appbar-pane.tsx')
facets=get('src/canvas/left/filter.tsx')
readiness=get('src/canvas/diagnostics/use-maestro-access.ts')
root=get('src/canvas/top/breadcrumb-renderers.tsx')

check('seedPersonalGraphs(' not in auth and 'setLoginDialogOpen(true)' not in auth,
      'login does not seed graphs or open itself')
check('updatePersonal(buildInsertData(' in seed and '/maestro-seed/' in seed,
      'the browser imports precompiled RDF using the existing SPARQL transport')
check('hasExplicitPersonalUpdateTemplates(structure)' in sparql,
      'personal graph mutation transport is graph-scoped')
check('updatePersonalSparql(' not in sparql,
      'no separate server Status mutation implementation')
check('fromPromise(' in access and 'checkBookmark' in access and 'BOOKMARK_CHECK_REQUESTED' in access,
      'XState access actor owns invoked bookmark verification')
check('type: "BOOKMARK_CHECK_REQUESTED"' in controller and 'BOOKMARK_CHECK_RESOLVED' not in controller,
      'React supplies a transport executor but cannot commit verification independently')
check('reenter: true' in access and 'bookmarkExecutor: null' in access,
      'session/query/bookmark changes invalidate the current verification actor')
check('const records = await fctProjectPage(queryXml, uris, meta, signal, false)' in providers,
      'read-only Provider catalog projects no personal Status or approval fields')
check('if (signal?.aborted) throw error' in providers and 'approvals = new Map' in providers,
      'optional approval failure cannot erase the provider cards')
check('hasSavedProviderQuery' not in fct,
      'generic FCT transport does not choose a bookmark-sensitive Providers path')
check('machineForTarget(machines, target)' in readiness and 'personalExists(' not in readiness,
      'personal policy readiness requires actual RDF state machine definitions')
check('openPinnedShareUrl' in controller and 'workspace.openPinnedShareUrl(destination.href)' in appbar,
      'pinned Providers share URLs restore through the in-app query transaction')
check('window.location.assign(destination.href)' not in appbar,
      'pinned Provider shortcuts do not reload and discard XState navigation')
check('ring-amber-400' not in appbar and '!border-amber-400' in appbar,
      'bookmark attention uses the actual rounded button border, not a square wrapper ring')
check('datatypeEvidenceScope: liveQueryScopeXml' in facets and 'liveQueryScopeXml = serializeFctQuery(tree)' in facets,
      'numeric facet datatype evidence is keyed to the live query, not a derived property view')
check('<InputGroup aria-label="Root breadcrumb"' in root,
      'root breadcrumb uses one shared shadcn InputGroup, including inherited minus')
print('Static lifecycle assertions passed; authenticated browser runtime acceptance not covered.')
