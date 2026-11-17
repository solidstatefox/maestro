// Node-only focused regression checks: no live endpoint or Next.js runtime needed.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { webcrypto } = require("node:crypto");

function compile(file, imports) {
  const code = ts.transpileModule(readFileSync(file, "utf8"), {fileName:file,
    compilerOptions: { target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
    return imports[name];
  }, crypto:webcrypto, TextEncoder, URL, window:{location:{origin:"https://maestro.example"}}, console}, {filename:file});
  return exports;
}
async function main() {
  const base="https://example.test/personal/query";
  const ctx={base,session:{graphStore:"https://example.test/sparql",graphPrefix:"https://example.test/personal",authHeader:"test"},addr:`${base}@https://example.test/sparql`};
  const updates=[];
  const helpers={personalContext:async()=>ctx, selectPersonal:async()=>[], updatePersonal:async(text)=>{updates.push(text)}, personalExists:async()=>true};
  const appbar=compile("src/lib/client-appbar-buttons.ts",{
    "@/lib/client-personal-sparql":helpers,
    "@/lib/query-identity": {canonicalQueryIdentityXml:(xml)=>xml},
    "@/lib/fct-sparql-translator": {compileFctXmlToSparql:()=>({query:"SELECT ?c1 WHERE { ?c1 ?p ?o }"})},
    "@/lib/feature-fct-query": {featureFctQuery:(_tree,kind,source,endpoint)=>({kind,source,endpoint})},
    "@/lib/fct-query-serialize": {serializeFctQuery:(tree)=>`<query src="${tree.kind}" addr="${tree.source}@${tree.endpoint}"><view type="list"/></query>`},
    "@/lib/fct-query-api":{},
  });
  const ensured=await appbar.manageAppbarButtons({action:"ensure-features"});
  assert.deepEqual(Array.from(ensured.buttons),[]);
  assert.equal(updates.length,21,"Five real Features bookmarks plus the facet icon migration");
  assert.ok(updates.every(text=>text.includes(`GRAPH <${base}`)),"Every write is in a personal named graph");
  assert.equal(updates.filter(text=>text.includes("historyQueryXML")).length,10);
  const inserted=await appbar.manageAppbarButtons({action:"add",bookmark:"https://example.test/personal/query#book",icon:"bookmark",tooltip:"Saved"});
  assert.equal(inserted.buttons.length,0);
  assert.equal(updates.length,22);
  await appbar.manageAppbarButtons({action:"remove",provider:"https://example.test/personal/button"});
  assert.equal(updates.length,23);
  const otc=compile("src/lib/client-otc-discovery.ts",{"@/lib/client-personal-sparql": {
    ...helpers, selectPersonal: async()=>[{transcoder:{value:"urn:survey:1"},title:{value:"Survey one"},description:{value:"Info"}}],
  }});
  const surveys=await otc.clientListChatSurveys();
  assert.equal(surveys.rulesGraph,`${base}/otc/transcoders`);
  assert.equal(surveys.surveys[0].title,"Survey one");
  assert.equal((await otc.clientVerifyOtcGraph("urn:source:graph")).exists,true);
  const registry=readFileSync("src/app/proxy/api/service/operations.ts","utf8");
  assert.ok(!registry.includes("'appbar-buttons':"));
  assert.ok(!/\botc-chat[^\n]*GET:/.test(registry));
  assert.ok(!/\botc[^\n]*GET:/.test(registry));
  assert.ok(!/\bontology[^\n]*GET:/.test(registry));
  console.log("PASS: appbar writes/list, OTC discovery and restricted service registry");
}
main().catch(e=>{console.error(e);process.exitCode=1});
