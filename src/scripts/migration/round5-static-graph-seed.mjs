/** Compile the repo's RDF documents into static RDFJS triple assets at BUILD
 * time, never while serving an authenticated user request. Blank nodes are
 * serialized in one browser-side SPARQL INSERT DATA per input document. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from 'n3';
import { RdfXmlParser } from 'rdfxml-streaming-parser';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const graph=join(root,'graph');
const out=join(root,'public','maestro-seed');
const manifest=JSON.parse(await readFile(join(graph,'manifest.json'),'utf8'));
await mkdir(out,{recursive:true});
const BASE='https://seed.maestro.invalid/base';
const formats={'.ttl':'Turtle','.nt':'N-Triples','.n3':'N3','.trig':'TriG','.nq':'N-Quads','.n4':'N-Quads'};
async function parse(content,file){
  const ext=extname(file).toLowerCase();
  if(formats[ext])return new Parser({format:formats[ext],baseIRI:BASE}).parse(content);
  if(['.rdf','.rdfs','.owl','.xml'].includes(ext))return new Promise((resolve,reject)=>{
    const parser=new RdfXmlParser({baseIRI:BASE});const quads=[];
    parser.on('data',q=>quads.push(q));parser.on('end',()=>resolve(quads));parser.on('error',reject);
    parser.write(content);parser.end();
  });
  throw Error(`Unsupported RDF format ${file}.`);
}
const term=t=>({termType:t.termType,value:t.value,...(t.termType==='Literal'?{language:t.language,datatype:{value:t.datatype.value}}:{})});
const entries=[];
for(const file of Object.keys(manifest).sort((a,b)=>a==='dataserver-seed.ttl'?-1:b==='dataserver-seed.ttl'?1:a.localeCompare(b))){
  if(!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(file)||file.includes('..'))throw Error(`Unsafe graph-seed path ${file}`);
  const destination=manifest[file];
  if(typeof destination!=='string')throw Error(`Invalid graph-seed destination ${file}`);
  const source=await readFile(join(graph,file),'utf8');
  const quads=await parse(source,file);
  const triples=quads.map(q=>({subject:term(q.subject),predicate:term(q.predicate),object:term(q.object)}));
  const digest=`sha256:${createHash('sha256').update(source,'utf8').digest('hex')}`;
  const asset=`${createHash('sha256').update(file).digest('hex')}.json`;
  await writeFile(join(out,asset),JSON.stringify({file,destination,digest,triples}));
  entries.push({file,destination,asset});
}
await writeFile(join(out,'manifest.json'),JSON.stringify(entries,null,2)+'\n');
// OTC model instructions are immutable deployment assets, not request-time filesystem reads.
await writeFile(join(out,'otc-survey-skill.md'),await readFile(join(root,'src','skills','otc-survey-skill.md')));
console.log(`Created ${entries.length} static RDF graph assets in public/maestro-seed.`);
