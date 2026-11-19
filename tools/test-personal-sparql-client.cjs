// Focused mock-HTTP verification of the generic SPARQL client transport.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const code = ts.transpileModule(readFileSync("src/lib/client-personal-sparql.ts", "utf8"), {
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
}).outputText;
const seen=[];
const session = { graphStore:"https://user.example/sparql", graphPrefix:"gttp://maestro.example/user", authHeader:"Basic redacted" };
const clientExports = {};
vm.runInNewContext(code, {exports:clientExports,require(name) {
  assert.equal(name,"@/lib/personal-auth");
  return {loadPersonalAuthSession:async()=>session,graphForPrefix:(p)=>`${p}/query`,personalReadEndpoint:(session)=>session.graphStore};
},fetch:async (url,opts)=> {
  seen.push({url,body:JSON.parse(opts.body),opts});
  if(seen.length===2)return {ok:true, status:204,headers:{get:()=>null},text:async()=>""};
  return {ok:true, status:200,headers:{get:()=>"application/sparql-results+json"},
    text:async()=>JSON.stringify({head:{vars:["v"]},results:{bindings:[{v:{type:"literal",value:"works"}}]}})};
}}, {filename:"src/lib/client-personal-sparql.ts"});
(async()=>{
  const ctx=await clientExports.personalContext();
  assert.equal(ctx.base,"gttp://maestro.example/user/query");
  assert.equal(ctx.addr,`${ctx.base}@https://user.example/sparql`);
  const rows=await clientExports.selectPersonal("SELECT ?v WHERE { VALUES ?v { 1 } }",ctx);
  assert.equal(rows[0].v.value,"works");
  await clientExports.updatePersonal(`INSERT DATA { GRAPH <${ctx.base}/appbar> { <urn:a> <urn:b> <urn:c> } }`);
  assert.equal(seen[0].url,"/proxy/api/sparql");
  assert.equal(seen[0].body.addr,ctx.addr);
  assert.equal(seen[1].body.update.includes("INSERT DATA"),true);
  assert.equal(seen[0].opts.credentials,"same-origin");
  assert.ok(!JSON.stringify(seen).includes("Basic redacted"),"Credentials must never be copied into JSON payloads");
  console.log("PASS: client SPARQL read-only endpoint, JSON SELECT, login-authenticated UPDATE envelope");
})().catch(e=>{console.error(e);process.exitCode=1});
