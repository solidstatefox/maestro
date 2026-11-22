import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFctXmlToSparql } from '../src/lib/fct-sparql-translator';
import { FCT_VIEW_TYPES } from '../src/lib/fct-view-types';

const xml = `<query xmlns="http://openlinksw.com/services/facets/1.0"
  addr="$ALL$@https://cordis.europa.eu/datalab/sparql">
  <property iri="http://data.europa.eu/s66#duration">
    <value datatype="http://www.w3.org/2001/XMLSchema#nonNegativeInteger">60</value>
  </property>
  <class iri="http://data.europa.eu/s66#Project"/>
  <view type="alphabet" index=""
    indexLabels="http://www.w3.org/2000/01/rdf-schema#label"
    limit="26" offset="0"/>
</query>`;

test('one grouped Alphabet query preserves every FCT constraint and distinct-resource counting', () => {
  const compiled = compileFctXmlToSparql(xml);
  assert.equal(compiled.view, FCT_VIEW_TYPES.ALPHABET);
  assert.match(compiled.query, /\?s1 <http:\/\/data\.europa\.eu\/s66#duration> \?s2/);
  assert.match(compiled.query, /FILTER \(\?s2 = "60"\^\^<http:\/\/www\.w3\.org\/2001\/XMLSchema#nonNegativeInteger>\)/);
  assert.match(compiled.query, /\?s1 <http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#type> <http:\/\/data\.europa\.eu\/s66#Project>/);
  assert.match(compiled.query, /<http:\/\/www\.w3\.org\/2000\/01\/rdf-schema#label> \?maestroLabel/);
  assert.match(compiled.query, /BIND\(SUBSTR\(UCASE\(STR\(\?maestroLabel\)\), 1, 1\) AS \?maestroLetter\)/);
  assert.match(compiled.query, /COUNT\(DISTINCT \?s1\) AS \?n/);
  assert.match(compiled.query, /GROUP BY \?maestroLetter/);
  assert.match(compiled.query, /LIMIT 26/);
  assert.doesNotMatch(compiled.query, /STRSTARTS/);
});

test('grouping a normalized initial does not split uppercase/lowercase label values', () => {
  // This specifically guards the older DBpedia Z=1 vs scalar Z=3 mismatch:
  // grouping the raw first character produced separate Z and z buckets.
  const compiled = compileFctXmlToSparql(xml);
  assert.match(compiled.query, /BIND\(SUBSTR\(UCASE\(STR\(\?maestroLabel\)\), 1, 1\) AS \?maestroLetter\)/);
  assert.match(compiled.query, /GROUP BY \?maestroLetter/);
  assert.doesNotMatch(compiled.query, /GROUP BY SUBSTR\(STR\(\?maestroLabel\)/);
});
