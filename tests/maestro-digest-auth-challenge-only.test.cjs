'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/lib/digest-auth.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function harness(steps){
  const sent=[];const mod={exports:{}};
  vm.runInNewContext(js,{module:mod,exports:mod.exports,URL,Response,WeakMap,Buffer,console,
    require:name=>{if(name==='node:crypto')return require('node:crypto');throw Error('Unexpected '+name);},
    fetch:async(url,init)=>{sent.push({url:String(url),init});return steps[sent.length-1]||new Response('',{status:500})}
  });
  return {api:mod.exports,sent};
}
const basic='Basic '+Buffer.from('alice:private-password').toString('base64');
const request={method:'POST',headers:{Authorization:basic,Accept:'application/sparql-results+json','Content-Type':'application/x-www-form-urlencoded'},body:'query=ASK%20%7B%7D'};
test('Virtuoso Digest challenge never exposes Basic credentials upstream',async()=>{
  const {api,sent}=harness([
    new Response('',{status:401,headers:{'WWW-Authenticate':'Digest realm="SPARQL",nonce="nonce-1",qop="auth",algorithm=MD5'}}),
    new Response('{"boolean":true}',{status:200,headers:{'Content-Type':'application/sparql-results+json'}})
  ]);
  const answer=await api.fetchWithDigestFallback('http://demo.openlinksw.com/sparql-auth',request);
  assert.equal(answer.status,200);assert.equal(sent.length,2);
  assert.equal(sent[0].init.headers.Authorization,undefined);
  assert.equal(sent[0].init.redirect,'manual');
  assert.match(sent[1].init.headers.Authorization,/^Digest username="alice"/);
  assert.doesNotMatch(sent[1].init.headers.Authorization,/private-password|Basic /);
  assert.match(sent[1].init.headers.Authorization,/uri="\/sparql-auth"/);
  assert.equal(sent[1].init.redirect,'manual');
});
test('HTTP 406 remains a real upstream 406; no credential retry',async()=>{
  const {api,sent}=harness([new Response('Not Acceptable',{status:406})]);
  const answer=await api.fetchWithDigestFallback('http://demo.openlinksw.com/sparql-auth',request);
  assert.equal(answer.status,406);assert.equal(sent.length,1);
  assert.equal(sent[0].init.headers.Authorization,undefined);
});
test('unexpected anonymous success is not accepted as proof of login',async()=>{
  const {api,sent}=harness([new Response('{"boolean":true}',{status:200})]);
  const answer=await api.fetchWithDigestFallback('http://demo.openlinksw.com/sparql-auth',request);
  assert.equal(answer.status,502);assert.equal(sent.length,1);
});
test('Digest failure preserves upstream 401 without loops',async()=>{
  const {api,sent}=harness([
    new Response('',{status:401,headers:{'WWW-Authenticate':'Digest realm="SPARQL",nonce="nonce-1",qop="auth"'}}),
    new Response('',{status:401})
  ]);
  const answer=await api.fetchWithDigestFallback('http://demo.openlinksw.com/sparql-auth',request);
  assert.equal(answer.status,401);assert.equal(sent.length,2);
});
test('Digest stale=true renews nonce once without sending Basic',async()=>{
  const {api,sent}=harness([
    new Response('',{status:401,headers:{'WWW-Authenticate':'Digest realm="SPARQL",nonce="nonce-1",qop="auth"'}}),
    new Response('',{status:401,headers:{'WWW-Authenticate':'Digest realm="SPARQL",nonce="nonce-2",qop="auth",stale=true'}}),
    new Response('{"boolean":true}',{status:200,headers:{'Content-Type':'application/sparql-results+json'}}),
  ]);
  const answer=await api.fetchWithDigestFallback('http://demo.openlinksw.com/sparql-auth',request);
  assert.equal(answer.status,200);assert.equal(sent.length,3);
  assert.equal(sent[0].init.headers.Authorization,undefined);
  assert.match(sent[1].init.headers.Authorization,/nonce="nonce-1"/);
  assert.match(sent[2].init.headers.Authorization,/nonce="nonce-2"/);
  assert.doesNotMatch(sent[2].init.headers.Authorization,/Basic |private-password/);
});
test('Digest repeated stale=true does not create an infinite retry loop',async()=>{
  const {api,sent}=harness([
    new Response('',{status:401,headers:{'WWW-Authenticate':'Digest realm="SPARQL",nonce="nonce-1",qop="auth"'}}),
    new Response('',{status:401,headers:{'WWW-Authenticate':'Digest realm="SPARQL",nonce="nonce-2",qop="auth",stale=true'}}),
    new Response('',{status:401,headers:{'WWW-Authenticate':'Digest realm="SPARQL",nonce="nonce-3",qop="auth",stale=true'}}),
  ]);
  const answer=await api.fetchWithDigestFallback('http://demo.openlinksw.com/sparql-auth',request);
  assert.equal(answer.status,401);assert.equal(sent.length,3);
});
