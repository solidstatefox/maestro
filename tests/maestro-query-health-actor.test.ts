import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphServerHealthController } from "../src/lib/app-lifecycle/graph-server-health-actor";

test("real health actor keeps HTTP 400 amber until the relevant query recovers", () => {
  const actor = createGraphServerHealthController();
  actor.start();
  const id = "server", endpointUrl = "https://example.org/sparql";
  const observed: Array<number|null> = [];
  const unsubscribe = actor.subscribe(() => observed.push(actor.getSnapshot()[id].status));
  const report = (operation: string, sequence: number, status: number|null, scope = 1) => actor.send({type:"QUERY_REPORTED",id,endpointUrl,operation,sequence,status,scope});
  report("results",1,400);
  assert.equal(actor.getSnapshot()[id].state,"degraded");
  actor.reportProbe({id,testedUrl:endpointUrl,status:200,state:"ok"},Date.now());
  report("categories",2,200);
  assert.equal(actor.getSnapshot()[id].status,400);
  report("results",3,200);
  assert.equal(actor.getSnapshot()[id].state,"ok");
  assert.deepEqual(observed,[400,200]);
  unsubscribe();actor.stop();
});
