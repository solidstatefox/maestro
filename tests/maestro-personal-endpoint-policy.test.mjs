import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { personalReadEndpoint, personalWriteEndpoint } from '../src/lib/personal-endpoints.ts';
const source=name=>fs.readFileSync(name,'utf8');
test('All personal SELECT/ASK reads use /sparql without re-routing to write service',()=>{
  const authModes=['sparql-auth','sparql-oauth','sparql-webid'];
  for(const authType of authModes) assert.equal(personalReadEndpoint({graphStore:'https://example.test/db/sparql',authType}),'https://example.test/db/sparql');
  assert.throws(()=>personalReadEndpoint({graphStore:'https://example.test/db/sparql-auth'}),/read-only/);
  assert.doesNotMatch(source('src/lib/personal-sparql.ts'),/response\.status === 401 && getPersonalSession/);
  assert.doesNotMatch(source('src/lib/client-personal-sparql.ts'),/graphStore\.replace/);
});
test('Writes select the method from login, not a read-side retry',()=>{
  const graphStore='https://example.test/db/sparql';
  assert.equal(personalWriteEndpoint({graphStore,authType:'sparql-auth'}),'https://example.test/db/sparql-auth');
  assert.equal(personalWriteEndpoint({graphStore,authType:'sparql-oauth'}),'https://example.test/db/sparql-oauth');
  assert.equal(personalWriteEndpoint({graphStore,authType:'sparql-webid'}),'https://example.test/db/sparql-webid');
  assert.throws(()=>personalWriteEndpoint({graphStore}),/Select a personal SPARQL authentication method/);
  assert.match(source('src/lib/personal-sparql.ts'),/personalWriteEndpoint\(assertPersonalSession\(request\)\)/);
});
