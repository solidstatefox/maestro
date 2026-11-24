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
test('user avatar follows HTTP failures and requires XState readiness for green', () => {
 const text=read('src/canvas/top/appbar-pane.tsx');
 assert.match(text,/\{authSession \? \(/);
 const access=read('src/lib/app-lifecycle/access.ts');
 assert.match(text,/workspace\.accessCapabilities\.userSignal/);
 assert.match(text,/workspace\.accessCapabilities\.userSignalLabel/);
 assert.match(access,/policyReady && status !== null && status >= 200 && status < 300 \? "green"/);
 assert.match(access,/challenge \? "401 — awaiting authenticated result"/);
 assert.match(access,/status >= 400 && status < 500/);
 assert.match(access,/status >= 500 && status < 600/);
 assert.match(text,/\(personalAuthStatus !== null \|\| loginTesting\) \? \(/);
 assert.match(text,/<TooltipContent>\{personalAuthBadgeLabel\}/);
});

test('all subscribed personal provider clients use the readiness capability rather than merely signedIn', () => {
 const appbar=read('src/canvas/top/appbar-pane.tsx');
 const facets=read('src/canvas/left/personal-widget-cards.tsx');
 const view=read('src/canvas/tab/view/page.tsx');
 assert.match(appbar,/!workspace\.authSession \|\| !workspace\.accessCapabilities\.canUsePersonalStore/);
 assert.doesNotMatch(facets,/if \(!workspace\.accessCapabilities\.canUsePersonalStore\) return null/);
 assert.match(facets,/sessionActive=\{workspace\.accessCapabilities\.canUsePersonalStore\}/);
 assert.match(view,/PersonalPerspectives key=\{selectedViewUri\} active=\{workspace\.accessCapabilities\.canUsePersonalStore\}/);
 assert.doesNotMatch(view,/PersonalPerspectives key=\{selectedViewUri\} active=\{workspace\.accessController\.getSnapshot\(\)\.value === "signedIn"\}/);
 const controller=read('src/canvas/utils/workspace-controller.tsx');
 assert.match(controller,/if \(!personalStoreReady\) return;\n    \/\/ A ribbon click alone|if \(!personalStoreReady\) return;/);
 assert.match(controller,/async function loadHistoryQuery\(includeFavorites = false\) \{\n    if \(!personalStoreReady \|\| isLoadingHistoryQuery\) return;/);
 assert.match(controller,/if \(authSession && personalStoreReady\) \{\n          templateHistoryFlushRef/);
});
