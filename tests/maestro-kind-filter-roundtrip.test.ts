import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateMaestroKinds, clearMaestroKinds, maestroKindFilter } from '../src/lib/maestro-kinds';
import { serializeFctQuery } from '../src/lib/fct-query-serialize';
import { compileFctXmlToSparql } from '../src/lib/fct-sparql-translator';
import { setQueryViewAttributes } from '../src/lib/fct-query-derived';
import type { FctQueryTree } from '../src/lib/fct-query';

test('actual FCT XML round-trip keeps the entire escaped predicate and its cache identity',()=>{
  try {
    hydrateMaestroKinds([{id:'web-url',pattern:'^https?://(?:a&b|c"d|<e>|[?]value|\\.test)'}]);
    const filter=maestroKindFilter('web-url');
    const tree:FctQueryTree={name:'query',attributes:{id:'a',addr:'http://dbpedia.org/resource/Daniel_Day-Lewis@https://linkeddata.uriburner.com/sparql'},children:[{
      id:'b',name:'view',attributes:{type:'properties',limit:'400',offset:'0',kind:'web-url',kindFilter:filter,'kindFilter-property':filter,'kindFilter-role':'isIRI(?value)'},children:[]
    }]};
    const clone=setQueryViewAttributes(tree,{'kindFilter-property':null,'kindFilter-role':null});
    assert.ok(tree.children[0].attributes['kindFilter-role']);
    const xml=serializeFctQuery(clone);
    assert.match(xml,/kindFilter="/);
    assert.match(xml,/&amp;/);assert.match(xml,/&quot;/);assert.match(xml,/&lt;/);
    assert.doesNotMatch(xml,/kindFilter-(property|role)/);
    const first=compileFctXmlToSparql(xml).query;
    assert.match(first,/REGEX\(STR\(\?o\)/);
    assert.ok(first.includes('[?]value'),'reserved variable-like characters inside regex remain literal');
    clearMaestroKinds();
    assert.equal(compileFctXmlToSparql(xml).query,first);
    hydrateMaestroKinds([{id:'web-url',pattern:'^https://'}]);
    const changed=serializeFctQuery(setQueryViewAttributes(clone,{kindFilter:maestroKindFilter('web-url')}));
    assert.notEqual(changed,xml);
    assert.notEqual(compileFctXmlToSparql(changed).query,first);
    assert.equal(compileFctXmlToSparql(xml).query,first);
    assert.throws(()=>compileFctXmlToSparql(serializeFctQuery(setQueryViewAttributes(clone,{kindFilter:null}))),/requires kindFilter/);
  } finally {clearMaestroKinds();}
});
