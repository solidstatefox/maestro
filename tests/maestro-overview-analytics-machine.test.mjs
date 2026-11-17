import { test } from 'node:test';
import assert from 'node:assert/strict';
let xstate = null;
let tsImport = null;
try {
  xstate = await import('xstate');
  // Node's built-in --experimental-strip-types does not resolve TS `@/` aliases.
  // Use Maestro's existing tsx dev dependency for this test's module graph.
  ({ tsImport } = await import('tsx/esm/api'));
} catch { /* Source-only test environment has no installed npm dependencies. */ }

test('analytics capability state rejects stale graph-server responses and unsupported products', { skip: !xstate || !tsImport }, async () => {
  const { overviewAnalyticsCapabilityMachine } = await tsImport('../src/lib/app-lifecycle/overview-analytics.ts', import.meta.url);
  const actor = xstate.createActor(overviewAnalyticsCapabilityMachine).start();
  const available = { product:'Virtuoso Universal Server',version:'07.20.3243',bi:true,native:false,reason:'BI supported' };
  actor.send({type:'CHECK',endpoint:'https://graph-a.example/sparql'});
  actor.send({type:'CHECK',endpoint:'https://graph-b.example/sparql'});
  actor.send({type:'RESOLVED',endpoint:'https://graph-a.example/sparql',capabilities:available});
  assert.equal(actor.getSnapshot().value,'checking');
  actor.send({type:'RESOLVED',endpoint:'https://graph-b.example/sparql',capabilities:available});
  assert.equal(actor.getSnapshot().value,'available');
  actor.send({type:'NATIVE_UNSUPPORTED',endpoint:'https://graph-a.example/sparql'});
  assert.equal(actor.getSnapshot().context.capabilities?.reason,'BI supported');
  actor.send({type:'CHECK',endpoint:'https://graph-c.example/sparql'});
  actor.send({type:'RESOLVED',endpoint:'https://graph-c.example/sparql',capabilities:{...available,product:'Other',bi:false,native:false}});
  assert.equal(actor.getSnapshot().value,'unsupported');
  actor.stop();
});
