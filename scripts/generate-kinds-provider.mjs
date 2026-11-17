/** Build a client-safe projection from the seeded Kinds mui:Provider RDF.
 * The Turtle file is authoritative; no regex or datatype lists live in TS.
 * Run before Next build/dev, after npm dependencies are installed. */
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import N3 from 'n3';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ttl=readFileSync(resolve(root,'graph/kinds/provider.ttl'),'utf8');
const store=new N3.Store(new N3.Parser().parse(ttl));
const ns='gttp://ggg.maestro.ecosys/ns/ui#';
const rdfs='http://www.w3.org/2000/01/rdf-schema#';
const provider='gttp://ggg.maestro.ecosys/shacl/provider/kinds';
const values=(subject,predicate)=>store.getObjects(subject,predicate,null);
const one=(subject,predicate)=>values(subject,predicate)[0]?.value??'';
if(!store.countQuads(provider,`${ns}widget`,null,null))throw new Error('Missing Kinds mui:Provider widgets');
const kinds=values(provider,`${ns}widget`).map(node=>{
  const id=node.value.slice(provider.length+1);
  const label=one(node,`${rdfs}label`);
  const scope=one(node,`${ns}scope`);
  if(!/^[a-z-]+$/.test(id)||!label||!scope)throw new Error(`Invalid Kind ${node.value}`);
  return {id,label,scope,pattern:one(node,`${ns}pattern`),datatypes:values(node,`${ns}datatype`).map(v=>v.value.slice(v.value.lastIndexOf('#')+1))};
});
const expected=['web-url','text','numeric','date','email','phone','anynomous'];
if(JSON.stringify(kinds.map(k=>k.id))!==JSON.stringify(expected))throw new Error('Kinds provider contents changed unexpectedly');
writeFileSync(resolve(root,'graph/kinds/provider.json'),JSON.stringify({provider,name:'Kinds',kinds},null,2)+'\n');
console.log('Generated graph/kinds/provider.json from graph/kinds/provider.ttl');
