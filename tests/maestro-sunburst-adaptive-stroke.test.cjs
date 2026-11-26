const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const SaxonJS=require('saxon-js');
const {Parser}=require('n3');
const TAU=2*Math.PI;
const close=(actual,expected,reason)=>assert.ok(Math.abs(actual-expected)<1e-6,`${reason}: ${actual} != ${expected}`);
const node=(name,count,selected=false,children='')=>`<node uri="urn:sector:${name}" label="${name}" count="${count}" selected="${selected}">${children}</node>`;
function render(stylesheet,tree){
  const source=`<facet><hierarchy>${tree}</hierarchy></facet>`;
  const raw=SaxonJS.XPath.evaluate("transform(map {'stylesheet-text':$stylesheet,'source-node':parse-xml($source),'delivery-format':'serialized'})?output",null,{params:{stylesheet,source}});
  const html=String(Array.isArray(raw)?raw[0]:raw);
  const paths=new Map();
  for(const match of html.matchAll(/<path\b[^>]*>/g)){
    const attrs=Object.fromEntries([...match[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    if(attrs['data-facet-value'])paths.set(attrs['data-facet-value'].slice('urn:sector:'.length),attrs);
  }
  return paths;
}
function verify(path,start,span,inner,outer){
  assert.ok(path,'sector emitted');
  assert.match(path.fill,/^hsl\(/);
  assert.equal(path['stroke-linejoin'],'round');
  const width=Number(path['stroke-width']),half=width/2;
  const extent=span-Math.min(.006,span/10),end=start+extent;
  assert.ok(Number.isFinite(width)&&width>=0);
  assert.ok(width<=2*inner*Math.sin(Math.min(extent,Math.PI)/2)/4+1e-9);
  assert.ok(width<=(outer-inner)/4+1e-9);
  const p=path.d.trim().split(/\s+/);
  assert.equal(p.length,23);
  assert.equal(p[0],'M');assert.equal(p[3],'A');assert.equal(p[11],'L');assert.equal(p[14],'A');assert.equal(p[22],'Z');
  const radii=[Number(p[4]),Number(p[15])];
  close(radii[0]+half,outer,'outer stroke remains in its ring');
  close(radii[1]-half,inner,'inner stroke remains in its ring');
  const signed=(angle,x,y)=>Math.cos(angle)*(x-160)+Math.sin(angle)*(y-160);
  for(const i of [1,20])close(signed(start,Number(p[i]),Number(p[i+1])),half,'start edge inset');
  for(const i of [9,12])close(signed(end,Number(p[i]),Number(p[i+1])),-half,'end edge inset');
  const angle=(i)=>Math.atan2(Number(p[i])-160,160-Number(p[i+1]));
  const positive=(a)=>(a+TAU)%TAU;
  const outerExtent=positive(angle(9)-angle(1)),innerExtent=positive(angle(12)-angle(20));
  assert.ok(outerExtent>0&&innerExtent>0,'positive painted arcs');
  assert.equal(Number(p[7]),outerExtent>Math.PI?1:0);
  assert.equal(Number(p[18]),innerExtent>Math.PI?1:0);
  if(width===0)assert.equal(path.stroke,'none');
  return width;
}
for(const [provider,inner,normal] of [['sunburst',45,.75],['sunburst-chartkit',38,1.25]]){
  const quads=new Parser().parse(fs.readFileSync(`graph/${provider}/provider.ttl`,'utf8'));
  const stylesheet=quads.find(q=>q.predicate.value==='gttp://ggg.maestro.ecosys/ns/ui#templateContent').object.value;
  test(`${provider}: large, narrow and tiny selected/unselected sectors retain their own colored geometry`,()=>{
    const cases=[['large',100000,false],['tiny',1,false],['medium',600,false],['selected-tiny',1,true],['last',50000,true]];
    const paths=render(stylesheet,cases.map(c=>node(...c)).join(''));
    const total=cases.reduce((s,c)=>s+c[1],0);
    let start=0;
    assert.equal(paths.size,cases.length);
    const widths=[];
    for(const [name,count,selected] of cases){
      const span=TAU*count/total;
      const path=paths.get(name);
      assert.equal(path['aria-checked'],String(selected));
      widths.push(verify(path,start,span,inner,70));start+=span;
    }
    close(widths[0],normal,'normal separator contribution');
    assert.equal(widths[1],0);assert.ok(widths[2]>0&&widths[2]<normal);
    assert.equal(widths[3],0);close(widths[4],1.5,'selected separator contribution');
    assert.equal(paths.get('last').stroke,'currentColor');
    assert.notEqual(paths.get('tiny').fill,paths.get('selected-tiny').fill);
  });
  test(`${provider}: single full-circle root and recursive tiny sibling`,()=>{
    const paths=render(stylesheet,node('root',100001,false,node('child',100000,true)+node('child-tiny',1)));
    const outer=88.5,mid=(inner+outer)/2;
    assert.equal(paths.size,3);
    close(verify(paths.get('root'),0,TAU,inner,mid),normal,'full-circle root');
    const childSpan=TAU*100000/100001;
    close(verify(paths.get('child'),0,childSpan,mid,outer),1.5,'large child');
    assert.equal(verify(paths.get('child-tiny'),childSpan,TAU/100001,mid,outer),0);
  });
}
