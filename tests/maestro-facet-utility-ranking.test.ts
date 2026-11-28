import test from 'node:test';
import assert from 'node:assert/strict';
import { facetValueUtility, rankFacetUtility, collectFacetUtilityRanking } from '../src/lib/facet-utility-ranking';
import { predicateRankAlgorithm } from '../src/lib/fct-view-types';
import { analyzePredicateCounts } from '../src/lib/fct-predicate-analytics';

const coverage = (...uris:string[]) => uris.map(uri=>({uri,subjects:100}));
const histogram = (uri:string,count:number,frequency:number) => ({uri,count,frequency});
const signal = () => new AbortController().signal;

test('FUR default, structural opt-in and unknown algorithm rejection',()=>{
  assert.equal(predicateRankAlgorithm(undefined),'fur');
  assert.equal(predicateRankAlgorithm('fur'),'fur');
  assert.equal(predicateRankAlgorithm('structural'),'structural');
  assert.throws(()=>predicateRankAlgorithm(''),/algorithm/);
  assert.throws(()=>predicateRankAlgorithm('unknown'),/algorithm/);
});

test('FUR penalizes unique and universal values, rewards shared discriminatory ones',()=>{
  assert.equal(facetValueUtility(1,100),0);
  assert.equal(facetValueUtility(100,100),0);
  assert.equal(facetValueUtility(1,1),0);
  assert.ok(facetValueUtility(50,100)>0.99);
  assert.ok(facetValueUtility(5,100)<facetValueUtility(20,100));
  const ranks=rankFacetUtility(100, coverage('homepage','party','nationality','constant'),[
    histogram('homepage',1,100),histogram('party',50,2),histogram('nationality',20,5),histogram('constant',100,1),
  ]);
  assert.deepEqual(ranks.map(r=>r.property),['party','nationality','constant','homepage']);
  assert.deepEqual(ranks.map(r=>r.rank),[1,2,3,4]);
});

test('coverage and normalized multivalued memberships do not multiply utility',()=>{
  const ranks=rankFacetUtility(100,[{uri:'broad',subjects:100},{uri:'sparse',subjects:50},{uri:'multi',subjects:100}],[
    histogram('broad',50,2),histogram('sparse',50,1),histogram('multi',50,20),
  ]);
  assert.deepEqual(ranks.map(r=>r.property),['broad','multi','sparse']);
  assert.deepEqual(rankFacetUtility(0,[],[]),[]);
  assert.equal(rankFacetUtility(1,[{uri:'one',subjects:1}],[histogram('one',1,1)])[0].rank,1);
});

test('malformed or incomplete counts cannot generate a plausible ranking',()=>{
  assert.throws(()=>rankFacetUtility(100,coverage('p'),[]),/Incomplete/);
  assert.throws(()=>rankFacetUtility(100,coverage('p'),[histogram('p',1,99)]),/Incomplete/);
  assert.throws(()=>rankFacetUtility(100,coverage('p'),[histogram('p',101,1)]),/Invalid/);
  assert.throws(()=>rankFacetUtility(100,coverage('p'),[histogram('p',50,2),histogram('p',50,2)]),/duplicate/);
  assert.throws(()=>rankFacetUtility(100,coverage('p'),[histogram('q',100,1)]),/Invalid/);
  assert.throws(()=>rankFacetUtility(100,coverage('p','p'),[]),/duplicate/);
  assert.throws(()=>rankFacetUtility(100,coverage('p'),[histogram('p',100,Number.MAX_SAFE_INTEGER)]),/safe integer/);
});

test('structural ranks are unchanged when only rank is requested, and no AHC result is manufactured',()=>{
  const counts=[{uri:'a',subjects:5},{uri:'b',subjects:5},{uri:'c',subjects:2}];
  const overlaps=[{left:'a',right:'b',sharedSubjects:5}];
  const full=analyzePredicateCounts(counts,overlaps,10,0.2);
  const rankOnly=analyzePredicateCounts(counts,overlaps,10,0.2,true);
  assert.deepEqual(rankOnly.ranks,full.ranks);
  assert.deepEqual(rankOnly.clusters,[]);
  assert.deepEqual(rankOnly.assignments,[]);
});

const int=(n:number)=>({type:'literal',value:String(n)});
const row=(uri:string,n:number,frequency?:number)=>({maestroPredicate:{type:'uri',value:uri},n:int(n),...(frequency===undefined?{}:{frequency:int(frequency)})});
const fixture = () => ({population:[{n:int(100)}],coverage:[row('home',100),row('party',100)],'value-counts':[row('home',1,100),row('party',50,2)]});

test('complete paginated FUR statistics consume terminal empty pages before publishing',async()=>{
  const data=fixture(); const calls:string[]=[];
  const ranks=await collectFacetUtilityRanking(async stage=>{
    calls.push(stage.kind+('offset' in stage?`:${stage.offset}`:''));
    return stage.kind==='population'?data.population:data[stage.kind].slice(stage.offset,stage.offset+stage.limit);
  },2,102,signal(),2);
  assert.deepEqual(calls,['population','coverage:0','coverage:2','value-counts:0','value-counts:2']);
  assert.deepEqual(ranks.map(r=>r.property),['party','home']);
});

test('FUR candidate and value group ceilings fail closed, including compressed frequencies',async()=>{
  const data=fixture();
  const read=async (stage:Parameters<Parameters<typeof collectFacetUtilityRanking>[0]>[0])=> stage.kind==='population'?data.population:data[stage.kind].slice(stage.offset,stage.offset+stage.limit);
  await assert.rejects(collectFacetUtilityRanking(read,1,102,signal(),2),{status:422});
  await assert.rejects(collectFacetUtilityRanking(read,2,101,signal(),2),{status:422});
});

test('cancellation and upstream errors stop FUR without partial ranks or automatic fallback',async()=>{
  const c=new AbortController(); let calls=0;
  await assert.rejects(collectFacetUtilityRanking(async()=>{calls++;c.abort();return [{n:int(100)}]},2,102,c.signal),{name:'AbortError'});
  assert.equal(calls,1);
  const err=new Error('HTTP 206 incomplete');
  await assert.rejects(collectFacetUtilityRanking(async stage=>{
    if(stage.kind==='population')return [{n:int(100)}];throw err;
  },2,102,signal()),e=>e===err);
});

test('duplicate page rows and missing property histograms are rejected',async()=>{
  await assert.rejects(collectFacetUtilityRanking(async stage=>{
    if(stage.kind==='population')return [{n:int(100)}];
    if(stage.kind==='coverage')return [row('p',100)];
    return [];
  },3,100,signal(),1),/Duplicate/);
  await assert.rejects(collectFacetUtilityRanking(async stage=>{
    if(stage.kind==='population')return [{n:int(100)}];
    if(stage.kind==='coverage')return [row('p',100)];
    return [];
  },3,100,signal(),2),/Incomplete/);
});
