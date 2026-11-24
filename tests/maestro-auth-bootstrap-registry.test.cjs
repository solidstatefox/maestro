const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const mapping=JSON.parse(read('graph/graph-registry.json'));
const manifest=JSON.parse(read('graph/manifest.json'));
test('one file-backed graph registry is authoritative for all seed destinations',()=>{
  assert.equal(mapping['state-machines'],'{base}/state-machines');
  assert.equal(mapping.status,'{base}/status');
  assert.equal(manifest['maestro-status-machines.ttl'],'state-machines');
  for(const [file,key] of Object.entries(manifest))
    assert.ok(mapping[key],`${file} references missing graph key ${key}`);
  assert.equal(new Set(Object.values(manifest)).size,5);
});
