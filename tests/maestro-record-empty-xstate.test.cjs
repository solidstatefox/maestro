const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
test('Record presentation does not start loading before the current Results identity is confirmed',()=>{
 const source=read('src/canvas/utils/workspace-controller.tsx');
 assert.match(source,/recordResultsReady = endpointReadyForQuery && operations\.execution\.queryPhase === "ready"/);
 assert.match(source,/resultsLoadedQueryIdentityRef\.current === activeQueryIdentityRef\.current/);
 assert.match(source,/selectedUri, recordIdentityPending, recordSelectionCleared, selectBrowseResult/);
});
test('Record uses formatted shadcn Skeleton until selection is confirmed without replacing existing clocks',()=>{
 const pane=read('src/canvas/right/pane.tsx');
 const skeleton=read('src/canvas/right/formatted-record-skeleton.tsx');
 assert.match(pane,/state="unconfirmed"/);
 assert.match(pane,/<FormattedRecordSkeleton/);
 assert.doesNotMatch(pane,/<Empty\b/);
 assert.match(pane,/!selectedUri && !recordSelectionCleared && !recordIdentityPending/);
 assert.match(pane,/\(isDescribing \|\| isLoadingRecordPolicy \|\| isFormattingRecord \|\| isValidatingRecord\)/);
 assert.match(skeleton,/data-maestro-record-skeleton="formatted"/);
 assert.match(skeleton,/ElapsedStatus/);
 assert.match(skeleton,/Skeleton/);
 assert.match(read('src/canvas/controllers/workspace-interfaces.ts'),/"recordIdentityPending"/);
});
