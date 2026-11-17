import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const text=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
const analytics=text('../src/canvas/tab/view/overview-node-analytics.tsx');
const version=text('../src/lib/app-lifecycle/overview-analytics.ts');
const metrics=text('../src/lib/app-lifecycle/overview-metric-request.ts');
const connections=text('../src/lib/app-lifecycle/overview-connections.ts');
const capability=text('../src/lib/app-lifecycle/access.ts');
const operations=text('../src/lib/app-lifecycle/operations.ts');
const diagnostics=text('../src/lib/app-lifecycle/coordinator.ts');

test('Overview version, metrics and paths have machine-invoked abortable actors',()=>{
 assert.match(version,/actors:\{probe:fromPromise/);
 assert.match(version,/onDone:/);
 assert.match(version,/reenter:true/);
 assert.match(metrics,/actors:\{runMetric:metricActor\}/);
 assert.match(metrics,/signal:AbortSignal/);
 assert.match(connections,/actors:\{findPaths:fromPromise/);
 assert.match(analytics,/useState\(createOverviewAnalyticsCapabilityController\)/);
 assert.match(analytics,/useState\(createOverviewMetricController\)/);
 assert.doesNotMatch(analytics,/fetch\(/);
 assert.match(analytics,/return \(\)=>actor\.stop\(\)/);
});
test('existing XState ownership boundaries remain authoritative and diagnostics stay passive',()=>{
 assert.match(capability,/createMaestroAccessController/);
 assert.match(operations,/createMaestroOperationsController/);
 assert.match(diagnostics,/Diagnostics are a passive projection/);
 assert.match(diagnostics,/Never a global singleton/);
});
