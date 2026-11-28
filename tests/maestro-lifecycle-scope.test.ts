import assert from "node:assert/strict";
import test from "node:test";
import { createMaestroQueryViewCoordinator, SHARED_QUERY_SCOPE, RECORD_QUERY_SCOPE, PERSONAL_QUERY_SCOPE, type MaestroQueryScope } from "../src/lib/app-lifecycle/query-view-ownership";

// Uses the production XState v5 actors, not the queue VM's test double.
test("independent lifetimes preserve shared and Record work across tabs, cancel stale work and isolate accounts", async () => {
  const c = createMaestroQueryViewCoordinator();
  c.start();
  try {
    c.observeScope("shared", "q1", true);
    c.observeScope("record", "q1/r1", true);
    c.observeScope("personal", "account1", true);
    c.setReady(true);
    const held = (scope: MaestroQueryScope) => {
      let finish: (()=>void)|undefined;
      let signal: AbortSignal|undefined;
      const promise = c.execute(scope, s => {signal=s;return new Promise<void>(resolve => {finish=resolve;});});
      void promise.catch(()=>{});
      return {promise,finish:()=>finish?.(),get signal(){return signal;}};
    };
    const shared=held(SHARED_QUERY_SCOPE),record=held(RECORD_QUERY_SCOPE),personal=held(PERSONAL_QUERY_SCOPE),browse=held({tab:"browse",ribbon:"browse"});
    await Promise.resolve();
    assert.ok(shared.signal && record.signal && personal.signal && browse.signal);
    c.select({...c.getSelection(),tab:"analyze",selectedAnalysisUri:"urn:analysis:one"});
    await assert.rejects(browse.promise,{name:"AbortError"});browse.finish();
    for(const item of [shared,record,personal])assert.equal(item.signal?.aborted,false);
    assert.equal(c.ownsPendingKey("shared:query"),true);
    c.setReady(true);
    let notifications=0;const unsubscribe=c.subscribe(()=>notifications++);
    c.observeScope("shared","q1",true);c.select(c.getSelection());c.setReady(true);c.resume();
    assert.equal(notifications,0);unsubscribe();
    const analysis=held({tab:"analyze",ribbon:"urn:analysis:one"});await Promise.resolve();
    c.observeScope("shared","q2",true);c.observeScope("record","q2/r2",true);
    for(const item of [shared,record,analysis]){await assert.rejects(item.promise,{name:"AbortError"});item.finish();}
    assert.equal(personal.signal?.aborted,false);
    c.observeScope("personal","",false);await assert.rejects(personal.promise,{name:"AbortError"});personal.finish();
    await assert.rejects(c.execute(PERSONAL_QUERY_SCOPE,async()=>1),{name:"AbortError"});
    c.observeScope("personal","account2",true);
    const jobs=[held(SHARED_QUERY_SCOPE),held(RECORD_QUERY_SCOPE),held(PERSONAL_QUERY_SCOPE)];await Promise.resolve();
    c.cancel();for(const item of jobs){await assert.rejects(item.promise,{name:"AbortError"});item.finish();}
    await assert.rejects(c.execute(SHARED_QUERY_SCOPE,async()=>1),{name:"AbortError"});
    c.resume();assert.equal(await c.execute(SHARED_QUERY_SCOPE,async()=>42),42);
    assert.equal(await c.execute(PERSONAL_QUERY_SCOPE,async()=>43),43);
    c.stop();c.start();assert.equal(await c.execute(SHARED_QUERY_SCOPE,async()=>44),44);
  } finally { c.stop(); }
});
