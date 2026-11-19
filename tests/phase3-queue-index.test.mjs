import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("pending queue item positions derive from existing scheduledGraphFetch queue", () => {
  const cache = read("src/lib/client-query-cache.ts");
  const appbar = read("src/canvas/top/appbar-pane.tsx");
  assert.match(cache, /queueIndex: number/);
  assert.match(cache, /requestQueue\.forEach\(\(job, index\)/);
  assert.match(cache, /if \(job\.owner\) browserPositions\.set\(job\.owner, index \+ 1\)/);
  assert.match(cache, /serverQueueIndex.*> 0/);
  assert.match(cache, /const displayPositions = new Map/);
  assert.match(cache, /refreshPendingQueueIndexes\(\)/);
  // A request that has already dispatched has no position in the waiting
  // queue; rendering "0." invented a queue position that does not exist.
  assert.match(appbar, /query\.serverQueueLaneIndex/);
  assert.match(appbar, /`\$\{query\.serverQueueLane\}\.\$\{query\.serverQueueLaneIndex\}`/);
  assert.match(appbar, /query\.queueIndex > 0 \? `browser\.\$\{query\.queueIndex\}` : "—"/);
  assert.doesNotMatch(appbar, /query\.queueIndex > 0 \? query\.queueIndex : "0"/);
  assert.match(appbar, /Cancel \$\{query\.label\}/);
});
