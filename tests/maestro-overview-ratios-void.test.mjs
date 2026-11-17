import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverviewReport, sharesOf, percentage } from '../src/lib/overview-metrics.ts';
import { publishedGraphAddress, publishedGraphRatios, readPublishedVoID } from '../src/lib/overview-void-metrics.ts';

const f = (kind,label,count)=>({uri:`https://example.org/${kind}#${label}`,label,count});
const source = {
 total:100,classes:[f('class','Person',70),f('class','Agent',55),f('class','Impossible',120)],
 properties:[f('property','label',95),f('property','description',80)],
 roles:[f('role','createdBy',40)],graphs:[f('graph','one',55),f('graph','two',45)],
 records: [
 {uri:'https://example.org/r1',title:'Alpha',termType:'uri',scopeValues:[
  {property:'https://example.org/description',label:'description',direction:'forward',values:[{value:'A',lang:'en'}]},
  {property:'https://example.org/some',label:'some',direction:'forward',values:[{value:'https://example.org/other',type:'uri'}]},
  {property:'https://example.org/lat',label:'lat',direction:'forward',values:[{value:'12',datatype:'http://www.w3.org/2001/XMLSchema#decimal'}]},
  {property:'https://example.org/long',label:'long',direction:'forward',values:[{value:'44',datatype:'http://www.w3.org/2001/XMLSchema#decimal'}]},
  {property:'https://example.org/year',label:'year',direction:'forward',values:[{value:'1997',datatype:'http://www.w3.org/2001/XMLSchema#gYear'}]},
 ]},
 {uri:'https://example.org/r2',title:'Beta',termType:'uri',scopeValues:[
  {property:'https://example.org/some',label:'some',direction:'forward',values:[{value:'https://example.org/other',type:'uri'}]},
  {property:'https://example.org/year',label:'year',direction:'forward',values:[{value:'2002',datatype:'http://www.w3.org/2001/XMLSchema#gYear'}]},
  {property:'https://example.org/long',label:'long',direction:'forward',values:[{value:'44',datatype:'http://www.w3.org/2001/XMLSchema#decimal'}]},
 ]},
 ]
};

test('class coverage uses FCT total, overlaps are allowed and invalid coverage excluded',()=>{
 const report=buildOverviewReport(source);
 assert.deepEqual(report.classCoverage.map(c=>[c.name,c.percentage]),[['Person',70],['Agent',55]]);
 assert.ok(Math.abs(report.classShares[0].percentage-120/245*100)<1e-9);
 assert.equal(report.summary.includes('70.0%'),true);
});
test('different ratio families retain their honest denominators',()=>{
 const r=buildOverviewReport(source);
 assert.ok(Math.abs(r.propertyShares[0].percentage-95/175*100)<1e-9);
 assert.equal(r.graphShares[0].percentage,55);
 assert.equal(r.languageShares[0].percentage,100);
 assert.equal(r.decadeShares.length,2);
 assert.equal(r.decadeShares[0].percentage,50);
 assert.equal(r.projectedUriValues,2);
 assert.equal(r.outgoingUriLinks,2);
 assert.equal(r.incomingUriLinks,0);
 assert.equal(r.averageUriLinks,1);
 assert.equal(r.connectedShares.length,2);
 assert.deepEqual(r.geo?.latitude,[12,12]);
 assert.equal(r.geo?.count,1);
 assert.equal(r.numericProperties.some(x=>x.label==='lat' && x.q1===12 && x.q3===12),true);
});
test('no empty data produces ratio cards or fabricated percentages',()=>{
 const r=buildOverviewReport({total:null,classes:[],properties:[],roles:[],graphs:[],records:[]});
 assert.deepEqual(r.classCoverage,[]);
 assert.deepEqual(r.languageShares,[]);
 assert.equal(r.geo,null);
 assert.deepEqual(sharesOf([{name:'x',value:1}],0),[]);
 assert.equal(percentage(99,0),0);
});
test('scope shares are finite percentages and skip invalid counts',()=>{
 const rows=sharesOf([{name:'a',value:8},{name:'b',value:2},{name:'bad',value:NaN}],10);
 assert.deepEqual(rows.map(r=>r.percentage),[80,20]);
});
test('VoID is never queried for Everywhere or missing graph, and endpoint is parsed from addr',()=>{
 assert.equal(publishedGraphAddress('@https://dbpedia.org/sparql'),null);
 assert.equal(publishedGraphAddress('$ALL$@https://dbpedia.org/sparql'),null);
 assert.deepEqual(publishedGraphAddress('https://example.org/g@https://dbpedia.org/sparql'),{graph:'https://example.org/g',endpoint:'https://dbpedia.org/sparql'});
 assert.equal(publishedGraphAddress('https://evil.org/\"@https://dbpedia.org/sparql'),null);
});
test('VoID statistics accept only known finite nonnegative integer metrics',()=>{
 const graph='https://example.org/g';
 const bindings=[
  ['triples','200'],['distinctSubjects','40'],['entities','25'],['classes','5'],['properties','15'],
  ['madeUp','9'],['distinctObjects','NaN']
 ].map(([name,amount])=>({metric:{value:`http://rdfs.org/ns/void#${name}`},amount:{value:amount}}));
 const stats=readPublishedVoID(graph,{results:{bindings}});
 assert.equal(stats?.values.triples,200);
 assert.equal(stats?.values.distinctObjects,undefined);
 const ratios=publishedGraphRatios(stats);
 assert.equal(ratios.find(r=>r.label==='Statements per subject')?.ratio,5);
 assert.equal(ratios.find(r=>r.label==='Entity / subject share')?.ratio,62.5);
 assert.equal(ratios.find(r=>r.label==='Properties per class')?.ratio,3);
 assert.equal(readPublishedVoID(graph,{results:{bindings:[]}}),null);
});
