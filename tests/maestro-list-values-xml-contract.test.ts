import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFctXmlToSparql } from '../src/lib/fct-sparql-translator';
import { getPath, indexFctPaths } from '../src/lib/fct-get-path';
const query = (children:string) => `<query xmlns="http://openlinksw.com/services/facets/1.0" addr="$ALL$@https://test.example/sparql" id="q" ctr="z" uctr="z">${children}</query>`;

test('list-values honors required AND and explicit uid OR',()=>{
  const two='<view id="v" type="list-values"/><property id="a" iri="urn:a"/><property id="b" iri="urn:b"/>';
  const and=compileFctXmlToSparql(query(two));
  assert.match(and.query,/<urn:a>/); assert.match(and.query,/<urn:b>/);
  assert.doesNotMatch(and.query,/UNION/);
  const or=compileFctXmlToSparql(query(two.replace(/iri="urn:a"/, 'iri="urn:a" uid="g"').replace(/iri="urn:b"/, 'iri="urn:b" uid="g"')));
  assert.match(or.query,/UNION/);
});

test('merge-values retains complete XML root resource page, including zero metadata',()=>{
  const out=compileFctXmlToSparql(query(`<value id="x" datatype="uri">urn:one</value><value id="y" datatype="uri">urn:two</value>
    <view id="v" type="merge-values" limit="2"/><property id="a" iri="urn:title"/><property id="b" iri="urn:doi"/>`));
  assert.deepEqual(out.resourcePage?.map(t=>t.value),['urn:one','urn:two']);
  assert.match(out.query,/VALUES \?s1/);
  assert.doesNotMatch(out.query,/<urn:title>|<urn:doi>/);
  assert.deepEqual(out.listValueProjections?.map(c=>c.id),['a','b']);
});

test('nested anchor is a single independent output column with per-hop direction',()=>{
  const out=compileFctXmlToSparql(query(`<value id="x" datatype="uri">urn:one</value><view id="v" type="merge-values"/>
    <property id="a" iri="urn:a" column="false"><property-of id="b" iri="urn:b"/></property><a id="c" href="b"/>`));
  assert.equal(out.listValueProjections?.length,1);
  assert.equal(out.listValueProjections?.[0]?.id,'c');
  assert.deepEqual(out.listValueProjections?.[0]?.hops?.map(h=>h.direction),['forward','reverse']);
  assert.doesNotMatch(out.query,/<urn:a>|<urn:b>/);
});

test('parent-indexed anchor getPath traverses backwards to the exact focus',()=>{
  type Node = {name:string;attributes:Record<string,string>;children:Node[]};
  const root:Node={name:'query',attributes:{id:'q'},children:[]};
  const a:Node={name:'property',attributes:{id:'a',iri:'urn:a'},children:[]};
  const b:Node={name:'property-of',attributes:{id:'b',iri:'urn:b'},children:[]};
  root.children.push(a);a.children.push(b);
  const index=indexFctPaths(root);
  assert.deepEqual(getPath(index,root,'b')?.path.map(h=>h.id),['a','b']);
  assert.equal(getPath(index,a,'q'),null);
  assert.equal(getPath(index,root,'missing'),null);
});

test('Project Results population remains hasResult, not union(title, doi)',()=>{
  const out=compileFctXmlToSparql(query(`<value id="x" datatype="uri">urn:project</value>
    <property id="r" iri="urn:hasResult"><view id="v" type="merge-values"/>
    <property id="t" iri="urn:title"/><property id="d" iri="urn:doi"/></property>`));
  assert.match(out.query,/<urn:hasResult>/);
  assert.doesNotMatch(out.query,/<urn:title>|<urn:doi>|UNION/);
  assert.deepEqual(out.listValueProjections?.map(c=>c.id),['t','d']);
});
