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
  // Do not merge unrelated browser/proxy queues into a synthetic rank.
  assert.doesNotMatch(cache, /const displayPositions = new Map/);
  assert.match(cache, /const next = detail.state === "queued" \? browserPositions.get\(controller\) \?\? 0 : 0/);
  assert.match(cache, /proxyDispatchConfirmed: queueIndex === 0/);
  assert.match(appbar, /function pendingQueryAddress/);
  assert.match(appbar, /`B:\$\{query.queueIndex\} · browser`/);
  assert.match(appbar, /`\$\{lane\}\$\{query.serverQueueLaneNumber\}:\$\{query.serverQueueLanePosition\} · \$\{query.serverQueueLane\}`/);
  assert.doesNotMatch(appbar, /browser\.\$\{query.queueIndex\}/);
  assert.match(appbar, /Cancel \$\{query\.label\}/);
});
