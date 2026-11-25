import { test } from "node:test";
import assert from "node:assert/strict";
import { createMaestroViewDiscoveryController } from "../src/lib/app-lifecycle/view-discovery";
import { createMaestroProviderCatalogController, selectProviderCatalog } from "../src/lib/app-lifecycle/provider-catalog";
import { createMaestroOperationsController } from "../src/lib/app-lifecycle/operations";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("Perspective discovery is single-flight and terminal for the same semantic key", async () => {
  const c = createMaestroViewDiscoveryController<string>(); c.start();
  let runs = 0;
  let finish!: (items: string[]) => void;
  const run = () => { runs++; return new Promise<string[]>(resolve => { finish = resolve; }); };
  try {
    c.discover("scope-a", run); c.discover("scope-a", run); await tick();
    assert.equal(runs, 1); assert.equal(c.getSnapshot().value, "loading");
    finish(["Graph Servers"]); await tick();
    assert.deepEqual(c.getSnapshot().context.items, ["Graph Servers"]);
    c.discover("scope-a", run); await tick(); assert.equal(runs, 1);
    c.discover("scope-b", run); await tick(); assert.equal(runs, 2);
    c.cancel(); c.discover("scope-b", run); await tick(); assert.equal(runs, 2);
    assert.equal(c.getSnapshot().value, "cancelled");
    c.discover("scope-b-refresh", run); await tick(); assert.equal(runs, 3);
    finish([]); await tick(); assert.equal(c.getSnapshot().value, "ready");
  } finally { c.stop(); }
});

test("Changing Perspective scope aborts the old invocation and accepts only the new result", async () => {
  const c = createMaestroViewDiscoveryController<string>(); c.start();
  let oldSignal: AbortSignal | undefined;
  let finish!: (items: string[]) => void;
  try {
    c.discover("old", signal => { oldSignal = signal; return new Promise(resolve => { finish = resolve; }); });
    await tick();
    c.discover("new", async () => ["new"]); await tick();
    assert.equal(oldSignal?.aborted, true);
    finish(["old"]); await tick(); assert.deepEqual(c.getSnapshot().context.items, ["new"]);
  } finally { c.stop(); }
});

test("Provider catalog waits for FCT once, renders once, and does not reexecute on repeated loading observations", async () => {
  const c = createMaestroProviderCatalogController(); c.start(); let runs = 0;
  let finish!: (result: {html:string;count:number}) => void;
  const run = () => { runs++; return new Promise<{html:string;count:number}>(resolve => { finish = resolve; }); };
  try {
    c.send({type:"CATALOG_WAITING",key:"page"});
    c.send({type:"CATALOG_WAITING",key:"page"});
    c.execute("page", run); c.execute("page", run);
    c.send({type:"CATALOG_WAITING",key:"page"}); await tick(); assert.equal(runs,1);
    finish({html:"<article>Graph Servers</article>",count:1}); await tick();
    assert.equal(selectProviderCatalog(c.getSnapshot(),"page").phase,"ready");
    c.send({type:"CATALOG_WAITING",key:"page"}); c.execute("page",run); await tick(); assert.equal(runs,1);
    c.execute("page-refresh",run); await tick(); assert.equal(runs,2);
    c.send({type:"CATALOG_CANCELLED",key:"page-refresh"}); c.execute("page-refresh",run); await tick(); assert.equal(runs,2);
  } finally { c.stop(); }
});

test("Results execution is claimed only in readyToExecute and a revision re-arms it", () => {
  const c = createMaestroOperationsController(); c.start();
  try {
    c.send({type:"QUERY_OBSERVED",key:"q",hydrated:true,graphReady:true});
    c.send({type:"RESULTS_STARTED",key:"q"}); c.send({type:"RESULTS_SUCCEEDED",key:"q"});
    c.send({type:"RESULTS_STARTED",key:"q"}); assert.equal(c.getSnapshot().query.phase,"ready");
    c.send({type:"QUERY_OBSERVED",key:"q-refresh",hydrated:true,graphReady:true});
    c.send({type:"RESULTS_STARTED",key:"q-refresh"}); assert.equal(c.getSnapshot().query.phase,"executing");
    c.send({type:"RESULTS_CANCELLED",key:"q-refresh"}); c.send({type:"RESULTS_STARTED",key:"q-refresh"});
    assert.equal(c.getSnapshot().query.phase,"cancelled");
  } finally { c.stop(); }
});

test("Completed Results do not rearm after same-key graph readiness flaps", () => {
  const c=createMaestroOperationsController();c.start();
  try {
    c.send({type:"QUERY_OBSERVED",key:"q",hydrated:true,graphReady:true});
    c.send({type:"RESULTS_STARTED",key:"q"});c.send({type:"RESULTS_SUCCEEDED",key:"q"});
    c.send({type:"QUERY_OBSERVED",key:"q",hydrated:true,graphReady:false});
    c.send({type:"QUERY_OBSERVED",key:"q",hydrated:true,graphReady:true});
    c.send({type:"RESULTS_STARTED",key:"q"});
    assert.equal(c.getSnapshot().query.phase,"ready");
    c.send({type:"QUERY_OBSERVED",key:"q-retry",hydrated:true,graphReady:true});
    assert.equal(c.getSnapshot().query.phase,"readyToExecute");
  } finally{c.stop();}
});
