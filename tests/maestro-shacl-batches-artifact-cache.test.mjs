import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
async function load(p){const code=ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);}
const {buildShapeBatchQuery,readShapeBatches,SHAPE_BATCH_SIZE}=await load('src/lib/shacl-shape-batch.ts');
const {sha256Hex,verifiedArtifactText,readVerifiedBuildArtifact}=await load('src/lib/verified-artifact-cache.ts');
const iri=value=>({type:'uri',value});
const row=(shape,value='v')=>({shape:iri(shape),s:{type:'bnode',value:'same-label'},p:iri('urn:p'),o:{type:'literal',value}});
const signal=()=>new AbortController().signal;
test('shape batch bounds each closure and carries an explicit named shape identity',()=>{
 const q=buildShapeBatchQuery('urn:graph',['urn:a','urn:b'],4001);
 assert.equal((q.match(/LIMIT 4001/g)||[]).length,2);
 assert.match(q,/BIND\(<urn:a> AS \?shape\)/);assert.match(q,/BIND\(<urn:b> AS \?shape\)/);
 assert.match(q,/LIMIT 8003$/);assert.throws(()=>buildShapeBatchQuery('urn:graph',['urn:bad> }'],4001));
});
test('one batch separates response-local closures and deduplicates repeated shape requests',async()=>{
 let calls=0;const got=await readShapeBatches('urn:g',['urn:a','urn:b','urn:a'],5,async()=>{calls++;return [row('urn:a','A'),row('urn:b','B')];},signal());
 assert.equal(calls,1);assert.deepEqual(got.get('urn:a').rows,[{s:row('urn:a').s,p:row('urn:a').p,o:{type:'literal',value:'A'}}]);
 assert.equal(got.get('urn:b').rows[0].o.value,'B');
});
test('missing and oversized closures fail closed without discarding valid independent shapes',async()=>{
 const got=await readShapeBatches('urn:g',['urn:a','urn:b','urn:c'],3,async()=>[row('urn:a'),row('urn:b','1'),row('urn:b','2'),row('urn:b','3')],signal());
 assert.equal(got.get('urn:a').rows.length,1);assert.match(got.get('urn:b').error.message,/incomplete/);assert.match(got.get('urn:c').error.message,/missing/);
});
test('a failed batch does not fan out or prevent later independent batches',async()=>{
 let calls=0;const ids=Array.from({length:SHAPE_BATCH_SIZE+1},(_,i)=>`urn:s${i}`);
 const got=await readShapeBatches('urn:g',ids,4,async()=>{calls++;if(calls===1)throw new Error('upstream incomplete');return [row(ids.at(-1))];},signal());
 assert.equal(calls,2);assert.ok(got.get(ids[0]).error);assert.equal(got.get(ids.at(-1)).rows.length,1);
});
test('cancellation prevents any further SHACL requests or publication',async()=>{
 const c=new AbortController();let calls=0;await assert.rejects(readShapeBatches('urn:g',['urn:a','urn:b'],3,async()=>{calls++;c.abort();return [row('urn:a')];},c.signal),{name:'AbortError'});assert.equal(calls,1);
});
test('unknown shape labels and malformed bindings cannot authorize a shape',async()=>{
 for(const rows of [[row('urn:unexpected')],[{...row('urn:a'),p:{type:'literal',value:'not an IRI'}}]]){
  const got=await readShapeBatches('urn:g',['urn:a'],3,async()=>rows,signal());assert.ok(got.get('urn:a').error);
 }
});
test('compiled artifact cache verifies actual bytes and rejects corruption, invalid digest and error status',async()=>{
 const text='{"N":"package"}',hash=await sha256Hex(new TextEncoder().encode(text));
 assert.equal(await verifiedArtifactText(new Response(text),hash),text);
 await assert.rejects(verifiedArtifactText(new Response('{}'),hash),/checksum/);
 await assert.rejects(verifiedArtifactText(new Response(text),'not-hash'),/digest/);
 await assert.rejects(verifiedArtifactText(new Response(text,{status:500}),hash),/HTTP 500/);
});
test('only the build artifact namespace is accepted',async()=>{
 await assert.rejects(readVerifiedBuildArtifact('https://example.com/x.json','a'.repeat(64)),/manifest entry/);
 await assert.rejects(readVerifiedBuildArtifact('/maestro-sef/../private.json','a'.repeat(64)),/manifest entry/);
});
test('current build pins both digests, and source-XSLT fallback is retained',()=>{
 assert.match(read('tools/compile-eurio-record-sef.mjs'),/assetSha256: createHash\("sha256"\)/);
 const runtime=read('src/lib/maestro-browser-xslt.ts');assert.match(runtime,/manifest.sourceSha256/);assert.match(runtime,/readVerifiedBuildArtifact\(manifest.asset,manifest.assetSha256\)/);assert.match(runtime,/stylesheetInternal: verified/);assert.match(runtime,/'stylesheet-text': \$stylesheet/);
});
test('page projection is snapshot-owned, scoped retry bypasses cache and explicit global cancellation reaches its actor',()=>{
 const source=read('src/canvas/utils/workspace-controller.tsx');assert.match(source,/analysisProjectionController\.discover\(projectionOperationKey/);assert.match(source,/analysisProjectionSnapshot\.matches\("ready"\)/);assert.match(source,/componentRetryHeaders\(analysisProjectionRetry\)/);assert.match(source,/analysisProjectionController\.cancel\(\)/);assert.doesNotMatch(source,/setAnalysisValuesState|setAnalysisValuesError/);
});
