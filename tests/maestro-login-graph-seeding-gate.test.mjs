import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(path,'utf8');
test('the shared XState access selector gates personal features until manifest seeding and verification finish', () => {
 const text=read('src/lib/app-lifecycle/access.ts');
 assert.match(text,/policyReady = sessionReady && snapshot\.context\.policyStage === "ready"/);
 assert.match(text,/canUsePersonalStore: policyReady/);
 assert.match(text,/canMutatePersonalStore: policyReady/);
 assert.match(text,/const bookmarked = policyReady && queryMatches/);
 assert.match(text,/bookmarkVerified: policyReady && queryMatches/);
});
test('authenticated avatar remains visible during XState seeding and has amber tooltip', () => {
 const text=read('src/canvas/top/appbar-pane.tsx');
 assert.match(text,/\{authSession \? \(/);
 assert.match(text,/const graphInitializationPending = Boolean\(authSession\)/);
 assert.match(text,/bg-amber-500/);
 assert.match(text,/<TooltipContent>\{graphInitializationPending \? "Graph loading in progress"/);
 assert.match(text,/motion-reduce:animate-none/);
});
test('all subscribed personal provider clients use the readiness capability rather than merely signedIn', () => {
 const appbar=read('src/canvas/top/appbar-pane.tsx');
 const facets=read('src/canvas/left/personal-widget-cards.tsx');
 const view=read('src/canvas/tab/view/page.tsx');
 assert.match(appbar,/!workspace\.authSession \|\| !workspace\.accessCapabilities\.canUsePersonalStore/);
 assert.match(facets,/if \(!workspace\.accessCapabilities\.canUsePersonalStore\) return null/);
 assert.match(facets,/sessionActive=\{workspace\.accessCapabilities\.canUsePersonalStore\}/);
 assert.match(view,/PersonalPerspectives active=\{workspace\.accessCapabilities\.canUsePersonalStore\}/);
 assert.doesNotMatch(view,/PersonalPerspectives active=\{workspace\.accessController\.getSnapshot\(\)\.value === "signedIn"\}/);
 const controller=read('src/canvas/utils/workspace-controller.tsx');
 assert.match(controller,/if \(!personalStoreReady\) return;\n    \/\/ A ribbon click alone|if \(!personalStoreReady\) return;/);
 assert.match(controller,/async function loadHistoryQuery\(includeFavorites = false\) \{\n    if \(!personalStoreReady \|\| isLoadingHistoryQuery\) return;/);
 assert.match(controller,/if \(authSession && personalStoreReady\) \{\n          templateHistoryFlushRef/);
});
