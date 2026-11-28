const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const read=path=>fs.readFileSync(path,'utf8');
const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022};
const moduleFrom=(source,globals={})=>{
  const holder={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:options}).outputText,
    {module:holder,exports:holder.exports,Error,AbortSignal,DOMException,fetch,...globals});
  return holder.exports;
};
const {loginConnectionMessage}=moduleFrom(read('src/lib/login-connection-error.ts'));
const chunkError=new Error('Failed to load chunk /_next/static/chunks/1qytqi_ic5yi9.js from module 39909');
const liveSignal=()=>new AbortController().signal;
test('a missing module with an unreachable Maestro origin reports server availability, not credentials',async()=>{
  let calls=0;
  const message=await loginConnectionMessage(chunkError,liveSignal(),async(url,init)=>{
    calls++;assert.equal(url,'/maestro-seed/manifest.json');assert.equal(init.method,'HEAD');
    assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.equal(init.body,undefined);
    assert.equal(init.headers,undefined);throw new TypeError('Failed to fetch');
  });
  assert.equal(calls,1);assert.match(message,/Cannot reach the Maestro server/);
  assert.doesNotMatch(message,/chunk|39909|credentials/);
});
test('a reachable origin with a missing chunk requests reload instead of relabeling authentication',async()=>{
  assert.match(await loginConnectionMessage(chunkError,liveSignal(),async()=>new Response(null,{status:200})),/Reload the page and reconnect/);
  assert.match(await loginConnectionMessage(chunkError,liveSignal(),async()=>new Response(null,{status:503})),/temporarily unavailable \(HTTP 503\)/);
  assert.match(await loginConnectionMessage(new Error('Maestro proxy unavailable (/proxy/api/sparql): Failed to fetch'),liveSignal(),async()=>{throw new Error('refused');}),/Cannot reach the Maestro server/);
  assert.match(await loginConnectionMessage(new DOMException('The operation timed out','TimeoutError'),liveSignal(),async()=>new Response(null,{status:200})),/timed out.*Maestro is reachable/);
});
test('real HTTP origin: running server is distinguished from a stopped server',async()=>{
  const {createServer}=require('node:http');
  const server=createServer((req,res)=>{assert.equal(req.method,'HEAD');assert.equal(req.url,'/maestro-seed/manifest.json');assert.equal(req.headers.authorization,undefined);res.writeHead(200);res.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const transport=(url,init)=>fetch(origin+url,init);
  try{assert.match(await loginConnectionMessage(chunkError,liveSignal(),transport),/Reload the page and reconnect/);}
  finally{await new Promise(resolve=>server.close(resolve));}
  assert.match(await loginConnectionMessage(chunkError,liveSignal(),transport),/Cannot reach the Maestro server/);
});
test('credential rejection and cancellation do not run a reachability probe',async()=>{
  const reject=async()=>{assert.fail('unexpected reachability probe');};
  const message='Personal SPARQL authentication was rejected (HTTP 401). Check your credentials and access permissions.';
  assert.equal(await loginConnectionMessage(new Error(message),liveSignal(),reject),message);
  const cancelled=new AbortController();cancelled.abort();
  assert.equal(await loginConnectionMessage(chunkError,cancelled.signal,reject),'Connection cancelled.');
  const during=new AbortController();
  assert.equal(await loginConnectionMessage(chunkError,during.signal,async()=>{during.abort();throw Error('abort');}),'Connection cancelled.');
  const controller=read('src/canvas/controllers/authentication.ts');
  assert.match(controller,/await loginConnectionMessage\(error,attempt.signal\);\s*if\(!attempt.signal.aborted\)deps.setLoginError\(message\)/);
});
test('password is genuinely empty without fake masking, and retains password-manager support',()=>{
  const ui=read('src/canvas/top/appbar-pane.tsx');
  const input=ui.match(/<Input\s+id="personal-password"[\s\S]*?\/>/)[0];
  assert.doesNotMatch(input,/placeholder=/);assert.match(input,/autoComplete="current-password"/);
  assert.match(input,/value=\{loginPassword\}/);assert.match(input,/type=\{loginShowPassword \? "text" : "password"\}/);
  assert.match(ui,/<Label htmlFor="personal-password">Password<\/Label>/);
  assert.match(read('src/canvas/controllers/authentication.ts'),/\[loginPassword, setLoginPassword\] = useState\(""\)/);
});
// Execute the actual layout-effect body with deterministic SVG matrices and
// observer doubles. This is not a browser layout or screenshot test.
const source=read('src/canvas/left/facet-presentation.tsx');
const ast=ts.createSourceFile('facet.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let effect, applyFrameSource;
function visit(node){
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useLayoutEffect'&&node.arguments[0]?.getText(ast).includes('settledPaint'))effect=node.arguments[0].getText(ast);
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='applyFrame')applyFrameSource=node.initializer.getText(ast);
  ts.forEachChild(node,visit);
}
visit(ast);assert.ok(effect);assert.ok(applyFrameSource);
const geometry=moduleFrom(read('src/lib/facet-frame-bounds.ts'));
class Matrix {
  constructor(scale=1,x=0,y=0){Object.assign(this,{scale,x,y});}
  inverse(){return new Matrix(1/this.scale,-this.x/this.scale,-this.y/this.scale);}
  multiply(m){return new Matrix(this.scale*m.scale,this.x+this.scale*m.x,this.y+this.scale*m.y);}
}
class Point {
  constructor(x,y){Object.assign(this,{x,y});}
  matrixTransform(m){return new Point(this.x*m.scale+m.x,this.y*m.scale+m.y);}
}
function fixture(native,frameWidth,wedgeBounds={x:90,y:90,width:140,height:140}){
  const group={getAttribute:()=> 'radial',style:{}};
  const attrs=new Map([['viewBox',native.join(' ')],['width','800'],['height','800']]);
  const current=()=>{const [x,y,width,height]=attrs.get('viewBox').split(' ').map(Number);return {x,y,width,height};};
  let brokenLabel=false, bboxReads=0, labelDrift=0;
  const svg={style:{},viewBox:{get baseVal(){return current();}},getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),
    hasAttribute:k=>attrs.has(k),removeAttribute:k=>attrs.delete(k),getBoundingClientRect:()=>({width:frameWidth}),
    getScreenCTM:()=>{const v=current();return new Matrix(frameWidth/v.width,-v.x*frameWidth/v.width,-v.y*frameWidth/v.width);},
    getBBox:()=>{throw Error('native fallback not required for a measurable chart');}};
  const element=(bounds,kind)=>({closest:q=>q==='[data-facet-label-style]'&&kind==='radial'?group:null,
    getScreenCTM:()=>svg.getScreenCTM().multiply(new Matrix(2.5)),getBBox:()=>{bboxReads++;if(kind==='label'&&brokenLabel)throw Error('font not ready');return kind==='label' ? {...bounds,x:bounds.x+labelDrift} : bounds;},
    computed:{display:'inline',visibility:'visible',stroke:kind==='wedge'?'red':'none',strokeWidth:'2'}});
  svg.querySelectorAll=()=>[element(wedgeBounds,'wedge'),element({x:110,y:155,width:100,height:10},'label'),element({x:-100,y:-100,width:900,height:900},'radial')];
  return {svg,group,attrs,setWidth:w=>frameWidth=w,breakLabel:()=>brokenLabel=true,shiftLabel:v=>labelDrift=v,bboxReads:()=>bboxReads};
}
function mount(chart,saved=null){
  let frame=chart, resize,mutate,raf, font, bounds, disconnected=0, mutationOptions;const persisted=[];
  const root={isConnected:true,querySelectorAll:()=>[frame.group],querySelector:()=>frame.svg};
  class RO {constructor(cb){resize=cb;}observe(){}disconnect(){disconnected++;}}
  class MO {constructor(cb){mutate=cb;}observe(_root,options){mutationOptions=options;}disconnect(){disconnected++;}}
  const globals={surfaceRef:{current:root},result:{error:''},labelStyle:'arc',...geometry,frameBoundsRef:{current:saved},paintBoundsRef:{current:null},resizeDrag:{current:null},setFrameBounds:v=>bounds=v,persistFrame:v=>persisted.push(v),
    DOMPoint:Point,getComputedStyle:e=>e.computed,ResizeObserver:RO,MutationObserver:MO,
    requestAnimationFrame:cb=>{raf=cb;return 1;},cancelAnimationFrame:()=>{raf=null;},
    document:{fonts:{addEventListener:(_e,cb)=>font=cb,removeEventListener:()=>{font=null;},ready:new Promise(()=>{})}},
    browserLog:{warn:()=>assert.fail('unexpected measurement failure')}};
  globals.applyFrame=moduleFrom(`module.exports=${applyFrameSource}`,globals);
  const cleanup=moduleFrom(`module.exports=${effect}`,globals)();
  const flush=()=>{const cb=raf;raf=null;cb?.();};
  return {cleanup,resize:()=>{resize();flush();},font:()=>{font();flush();},replace:next=>{frame=next;mutate();flush();},bounds:()=>bounds,persisted,disconnected:()=>disconnected,mutationOptions:()=>mutationOptions};
}
test('saved frame width and old oversized native viewBox do not determine SVG padding',()=>{
  const a=fixture([0,0,800,800],443), b=fixture([190,190,420,420],266);
  const aa=mount(a),bb=mount(b);
  // The painted wedge bounds (including stroke) are 222.5..577.5
  // in each axis after the provider scale, with exactly 1 unit padding.
  assert.equal(a.attrs.get('viewBox'),'221.5 221.5 357 357');
  assert.equal(b.attrs.get('viewBox'),a.attrs.get('viewBox'));
  assert.equal(a.svg.style.width,'100%');assert.equal(a.svg.style.aspectRatio,'357 / 357');
  assert.equal(a.group.style.display,'none');assert.ok(!a.attrs.has('width')&&!a.attrs.has('height'));
  a.setWidth(300);aa.resize();assert.equal(a.attrs.get('viewBox'),'221.5 221.5 357 357');
  aa.cleanup();bb.cleanup();assert.equal(aa.disconnected(),2);
});
test('replacement DOM and a temporarily unmeasurable label are reconciled without a new provider transform',()=>{
  const a=fixture([0,0,800,800],443);const mounted=mount(a);
  const next=fixture([0,0,800,800],443);next.breakLabel();mounted.replace(next);
  assert.equal(next.attrs.get('viewBox'),'221.5 221.5 357 357');
  mounted.font();assert.equal(next.attrs.get('viewBox'),'221.5 221.5 357 357');
  mounted.cleanup();assert.equal(mounted.disconnected(),2);
});

test('arc bounds settle after one measure instead of following their own resize notifications',()=>{
  const chart=fixture([0,0,800,800],443);
  const mounted=mount(chart);
  const initialReads=chart.bboxReads();
  assert.ok(initialReads>0,'first measure reads label bounds');
  // Updating viewBox and aspect ratio triggers resize observer notifications.
  // Those notifications must NOT read arc textPath boxes again: doing so can
  // generate an oscillating viewBox and visible vibration in Chrome.
  for(let i=0;i<12;i++) mounted.resize();
  assert.equal(chart.bboxReads(),initialReads);
  assert.equal(chart.attrs.get('viewBox'),'221.5 221.5 357 357');
  assert.deepEqual(JSON.parse(JSON.stringify(mounted.mutationOptions())),{childList:true,subtree:true},
    'do not observe viewBox, width or height attributes written by measurement');
  mounted.font();
  assert.ok(chart.bboxReads()>initialReads,'font readiness must still force a new measurement');
  mounted.cleanup();
});

// Preserve the original chart origin; do not mirror the actual occupied extents.
test('asymmetric arc geometry produces a tight non-centered rectangle',()=>{
  const chart=fixture([0,0,800,800],443,{x:90,y:100,width:120,height:150});
  const mounted=mount(chart);
  const [x,y,w,h]=chart.attrs.get('viewBox').split(' ').map(Number);
  assert.equal(x,221.5);
  assert.equal(y,246.5);
  assert.equal(w,307);
  assert.equal(h,382);
  assert.notEqual(w,h,'frame follows actual horizontal and vertical extents');
  mounted.cleanup();
});
test('tiny arc label shifts after font readiness cannot induce resize-box quiver',()=>{
  const chart=fixture([0,0,800,800],443,{x:125,y:125,width:80,height:80});
  const mounted=mount(chart);
  const stable=chart.attrs.get('viewBox');
  for(const dx of [0.12,-0.13,0.15,-0.17,0.1,0]){
    chart.shiftLabel(dx);mounted.font();
    assert.equal(chart.attrs.get('viewBox'),stable);
  }
  mounted.cleanup();
});

test('top-only growth preserves all other stored frame edges and persists the grown rectangle',()=>{
  const chart=fixture([0,0,800,800],443,{x:90,y:90,width:140,height:140});
  const saved={left:200,top:200,right:600,bottom:600};
  const mounted=mount(chart,saved);
  assert.equal(chart.attrs.get('viewBox'),'200 200 400 400');
  assert.equal(mounted.persisted.length,0);
  const next=fixture([0,0,800,800],443,{x:90,y:50,width:140,height:180});
  mounted.replace(next);
  assert.equal(next.attrs.get('viewBox'),'200 121.5 400 478.5');
  assert.deepEqual(JSON.parse(JSON.stringify(mounted.persisted.at(-1))),{...saved,top:121.5});
  mounted.cleanup();
});
test('all four edges trim whitespace then scale uniformly past contact, without a wall',()=>{
  const {resizeFrameEdge,includePaint,readFrameBounds,frameScale}=geometry;
  const paint={left:10,top:20,right:100,bottom:200}, saved={left:0,top:0,right:120,bottom:220};
  for(const edge of ['left','top','right','bottom']){
    const sign=edge==='left'||edge==='top'?-1:1;
    const slack=(saved[edge]-paint[edge])*sign;
    const expanded=resizeFrameEdge(saved,paint,edge,sign*15);
    assert.equal(expanded[edge],saved[edge]+sign*15);
    for(const other of Object.keys(saved).filter(key=>key!==edge))assert.equal(expanded[other],saved[other]);
    const trimmed=resizeFrameEdge(saved,paint,edge,-sign*slack/2);
    assert.equal(trimmed[edge],saved[edge]-sign*slack/2);
    assert.equal(frameScale(trimmed),1);
    const contact=resizeFrameEdge(saved,paint,edge,-sign*slack);
    assert.equal(contact[edge],paint[edge]);assert.equal(frameScale(contact),1);
    const beyond=resizeFrameEdge(saved,paint,edge,-sign*(slack+15));
    assert.equal(beyond[edge],paint[edge]);assert.ok(frameScale(beyond)<1);
    const outward=resizeFrameEdge(contact,paint,edge,sign*15);
    assert.equal(outward[edge],paint[edge]);assert.ok(frameScale(outward)>1);
    const opposite={left:'right',right:'left',top:'bottom',bottom:'top'}[edge];
    const span=Math.abs(contact[edge]-contact[opposite]);
    assert.ok(Math.abs(span*frameScale(beyond)-(span-15))<1e-9);
    assert.ok(Math.abs(span*frameScale(outward)-(span+15))<1e-9);
    assert.deepEqual(JSON.parse(JSON.stringify(readFrameBounds(JSON.stringify(outward)))),JSON.parse(JSON.stringify(outward)));
  }
  assert.equal(readFrameBounds('{"width":420}'),null);
  assert.equal(readFrameBounds('{"left":1,"top":1,"right":0,"bottom":2}'),null);
  const growth=includePaint({...saved,scale:0.75},{...paint,top:-40});
  assert.deepEqual(JSON.parse(JSON.stringify(growth)),{...saved,scale:0.75,top:-40});
});
test('diagonal resizing preserves the irregular rectangle aspect and zoom survives storage',()=>{
  const {resizeFrameCorner,frameScale,readFrameBounds,resizeFrameEdge}=geometry;
  const rect={left:10,top:20,right:110,bottom:220,scale:2};
  const grown=resizeFrameCorner(rect,40,20);
  assert.equal(frameScale(grown),2.4);
  const shrunk=resizeFrameCorner(grown,-24,-48);
  assert.equal(frameScale(shrunk),2.16);
  for(const edge of ['left','top','right','bottom'])assert.equal(grown[edge],rect[edge]);
  assert.equal(frameScale(readFrameBounds(JSON.stringify(grown))),2.4);
  assert.equal(frameScale(resizeFrameEdge(rect,rect,'left',100000)),0.05);
  assert.equal(frameScale(resizeFrameCorner(rect,1e6,1e6)),20);
});
test('saved zoom retains the same native viewBox on a provider refresh and only grows the crossed edge',()=>{
  const chart=fixture([0,0,800,800],443);
  const saved={left:200,top:200,right:600,bottom:600,scale:0.6};
  const mounted=mount(chart,saved);
  assert.equal(chart.attrs.get('viewBox'),'200 200 400 400');
  const next=fixture([0,0,800,800],443,{x:90,y:50,width:140,height:180});
  mounted.replace(next);
  assert.deepEqual(JSON.parse(JSON.stringify(mounted.persisted.at(-1))),{...saved,top:121.5});
  mounted.cleanup();
});
