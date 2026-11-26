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
  assert.match(controller,/await loginConnectionMessage\(error,attempt.signal\);\s*if\(isCurrentPersonalInitialization\(attempt\)\)deps.setLoginError\(message\)/);
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
let effect;
function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useLayoutEffect'&&node.arguments[0]?.getText(ast).includes('originalViews.current'))effect=node.arguments[0].getText(ast);ts.forEachChild(node,visit);}
visit(ast);assert.ok(effect);
class Matrix {
  constructor(scale=1,x=0,y=0){Object.assign(this,{scale,x,y});}
  inverse(){return new Matrix(1/this.scale,-this.x/this.scale,-this.y/this.scale);}
  multiply(m){return new Matrix(this.scale*m.scale,this.x+this.scale*m.x,this.y+this.scale*m.y);}
}
class Point {
  constructor(x,y){Object.assign(this,{x,y});}
  matrixTransform(m){return new Point(this.x*m.scale+m.x,this.y*m.scale+m.y);}
}
function fixture(native,frameWidth){
  const group={getAttribute:()=> 'radial',style:{}};
  const attrs=new Map([['viewBox',native.join(' ')],['width','800'],['height','800']]);
  const current=()=>{const [x,y,width,height]=attrs.get('viewBox').split(' ').map(Number);return {x,y,width,height};};
  let brokenLabel=false;
  const svg={style:{},viewBox:{get baseVal(){return current();}},getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),
    hasAttribute:k=>attrs.has(k),removeAttribute:k=>attrs.delete(k),getBoundingClientRect:()=>({width:frameWidth}),
    getScreenCTM:()=>{const v=current();return new Matrix(frameWidth/v.width,-v.x*frameWidth/v.width,-v.y*frameWidth/v.width);},
    getBBox:()=>{throw Error('native fallback not required for a measurable chart');}};
  const element=(bounds,kind)=>({closest:q=>q==='[data-facet-label-style]'&&kind==='radial'?group:null,
    getScreenCTM:()=>svg.getScreenCTM().multiply(new Matrix(2.5)),getBBox:()=>{if(kind==='label'&&brokenLabel)throw Error('font not ready');return bounds;},
    computed:{display:'inline',visibility:'visible',stroke:kind==='wedge'?'red':'none',strokeWidth:'2'}});
  svg.querySelectorAll=()=>[element({x:90,y:90,width:140,height:140},'wedge'),element({x:110,y:155,width:100,height:10},'label'),element({x:-100,y:-100,width:900,height:900},'radial')];
  return {svg,group,attrs,setWidth:w=>frameWidth=w,breakLabel:()=>brokenLabel=true};
}
function mount(chart){
  let frame=chart, resize,mutate,raf, font, width, disconnected=0;
  const root={isConnected:true,querySelectorAll:()=>[frame.group],querySelector:()=>frame.svg};
  class RO {constructor(cb){resize=cb;}observe(){}disconnect(){disconnected++;}}
  class MO {constructor(cb){mutate=cb;}observe(){}disconnect(){disconnected++;}}
  const globals={surfaceRef:{current:root},result:{error:''},labelStyle:'arc',originalViews:{current:new WeakMap()},setNaturalWidth:v=>width=v,
    DOMPoint:Point,getComputedStyle:e=>e.computed,ResizeObserver:RO,MutationObserver:MO,
    requestAnimationFrame:cb=>{raf=cb;return 1;},cancelAnimationFrame:()=>{raf=null;},
    document:{fonts:{addEventListener:(_e,cb)=>font=cb,removeEventListener:()=>{font=null;},ready:new Promise(()=>{})}},
    browserLog:{warn:()=>assert.fail('unexpected measurement failure')}};
  const cleanup=moduleFrom(`module.exports=${effect}`,globals)();
  const flush=()=>{const cb=raf;raf=null;cb?.();};
  return {cleanup,resize:()=>{resize();flush();},font:()=>{font();flush();},replace:next=>{frame=next;mutate();flush();},width:()=>width,disconnected:()=>disconnected};
}
test('saved frame width and old oversized native viewBox do not determine SVG padding',()=>{
  const a=fixture([0,0,800,800],443), b=fixture([190,190,420,420],266);
  const aa=mount(a),bb=mount(b);
  // The painted wedge bounds (including stroke) are 222.5..577.5
  // in each axis after the provider scale, with exactly 8 units padding.
  assert.equal(a.attrs.get('viewBox'),'214.5 214.5 371 371');
  assert.equal(b.attrs.get('viewBox'),a.attrs.get('viewBox'));
  assert.equal(a.svg.style.width,'100%');assert.equal(a.svg.style.aspectRatio,'371 / 371');
  assert.equal(a.group.style.display,'none');assert.ok(!a.attrs.has('width')&&!a.attrs.has('height'));
  a.setWidth(300);aa.resize();assert.equal(a.attrs.get('viewBox'),'214.5 214.5 371 371');
  aa.cleanup();bb.cleanup();assert.equal(aa.disconnected(),2);
});
test('replacement DOM and a temporarily unmeasurable label are reconciled without a new provider transform',()=>{
  const a=fixture([0,0,800,800],443);const mounted=mount(a);
  const next=fixture([0,0,800,800],443);next.breakLabel();mounted.replace(next);
  assert.equal(next.attrs.get('viewBox'),'214.5 214.5 371 371');
  mounted.font();assert.equal(next.attrs.get('viewBox'),'214.5 214.5 371 371');
  mounted.cleanup();assert.equal(mounted.disconnected(),2);
});
