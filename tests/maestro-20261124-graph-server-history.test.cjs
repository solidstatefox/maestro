const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=p=>fs.readFileSync(p,'utf8');
function fixture(){
  const memory=new Map(),updates=[],reads=[],events=[];
  const ctx={session:{username:'alice'},base:'https://personal.example/alice',addr:'https://personal.example/alice@https://personal.example/sparql-auth'};
  let fail=false;
  const code=ts.transpileModule(source('src/lib/client-graph-server-status-history.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const m={exports:{}};
  const context={module:m,exports:m.exports,URL,Date,crypto:require('node:crypto').webcrypto,window:{dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail;}},require(name){
    if(name==='@/lib/client-personal-sparql')return {personalContext:async()=>ctx,updatePersonal:async(q,_a,_b,_source,session)=>{assert.equal(session,ctx.session);updates.push(q);if(fail)throw Error('store unavailable');},selectPersonal:async(q)=>{reads.push(q);return [{endpoint:{value:'https://personal.example/sparql'},at:{value:'2026-11-24T10:00:00Z'},state:{value:'ok'},code:{value:'200'}},{endpoint:{value:'https://public.example/sparql'},at:{value:'2026-11-24T11:00:00Z'},state:{value:'unreachable'}}];}};
    if(name==='@/lib/graph-server-directory')return {validGraphServerUrl:s=>{try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}}};
    if(name==='@/lib/graph-context')return {graphServerStatusGraph:b=>b+'/graph/server-status'};
    if(name==='@/lib/maestro-storage')return {initializeMaestroStorage:async()=>{},maestroStorageGet:k=>memory.get(k),maestroStorageSet:(k,v)=>memory.set(k,v)};
    throw Error(name);
  }};
  vm.runInNewContext(code,context);
  return {api:m.exports,memory,updates,reads,events,fail:v=>fail=v};
}
test('status transition persists timestamp, actual HTTP code and event type; failed writes retry the same RDF identity',async()=>{
  const f=fixture(),endpoint='https://personal.example/sparql',at=Date.parse('2026-11-24T10:00:00Z');
  f.fail(true);
  await assert.rejects(f.api.recordGraphServerStatusObservation(endpoint,{state:'ok',status:200},at),/store unavailable/);
  const queued=JSON.parse([...f.memory.values()][0]);assert.equal(queued.length,1);assert.equal(queued[0].created,'2026-11-24T10:00:00.000Z');
  f.fail(false);await f.api.retryGraphServerStatusObservations();
  assert.equal(f.updates[0],f.updates[1]);assert.match(f.updates[1],/healthState> "ok"/);assert.match(f.updates[1],/httpStatus> "200"/);
  assert.equal(JSON.parse([...f.memory.values()][0]).length,0);
  await f.api.recordGraphServerStatusObservation(endpoint,{state:'ok',status:200},at+1);
  assert.equal(f.updates.length,2);
  await f.api.recordGraphServerStatusObservation(endpoint,{state:'degraded',status:null},at+2);
  assert.match(f.updates[2],/noHttpResponse> true/);assert.doesNotMatch(f.updates[2],/httpStatus> "0"/);
  await f.api.recordGraphServerStatusObservation(endpoint,{state:'ok',status:200},at+3);assert.equal(f.updates.length,4);
});
test('one private RDF read retrieves observations for all cards; daily colors reflect actual upstream evidence',async()=>{
  const f=fixture(),rows=await f.api.readGraphServerStatusHistories();assert.equal(rows.length,2);assert.equal(f.reads.length,1);assert.match(f.reads[0],/SELECT \?endpoint \?at \?state \?code/);
  assert.equal(rows[0].status,200);assert.equal(rows[1].status,null);
  const day=rows[0].created;
  const color=(state,status)=>f.api.graphStatusDaily([{created:day,state,status}])[0].value;
  assert.equal(color('ok',200),3);assert.equal(color('http-error',403),2);assert.equal(color('unreachable',null),2);assert.equal(color('server-error',503),1);
});
test('card rendering and scalar count cannot be rearmed by health metadata, and status reads are shared',()=>{
  const w=source('src/canvas/utils/workspace-controller.tsx'),key=w.slice(w.indexOf('const viewRenderInputKey ='),w.indexOf('const genericPerspectiveActive ='));
  assert.doesNotMatch(key,/endpointStatuses|checkingEndpointIds|viewServerSoftware|viewServerDescriptions|viewDomainRanks/);
  assert.match(w,/countController\.discover\(countKey/);assert.match(w,/subscribeEndpointStatuses\(observe\)/);
  const history=source('src/canvas/tab/view/graph-server-status-history.tsx');assert.match(history,/readGraphServerStatusHistories\(range, signal\)/);assert.match(history,/useContext\(HistoryContext\)/);
  const manager=source('src/canvas/tab/view/graph-server-manager.tsx');assert.match(manager,/directory\.discover\(directoryKey/);assert.doesNotMatch(manager,/<GraphServerStatusHistory|<article/);
  const view=source('src/canvas/tab/view/view-components.tsx');assert.match(view,/healthSlots\.map/);assert.match(view,/createPortal\(<GraphServerStatusHistory/);
});
test('Perspective markup and its status portals share one keyed lifetime',()=>{
  const view=source('src/canvas/tab/view/view-components.tsx');
  const boundary=view.indexOf('function PerspectiveHtmlSurface(');
  assert.ok(boundary>0);
  const parent=view.slice(0,boundary),surface=view.slice(boundary);
  assert.match(parent,/\<PerspectiveHtmlSurface key=\{JSON\.stringify\(\[selectedView\.uri, graphServerHtml\]\)\}/);
  assert.doesNotMatch(parent,/setHealthSlots|healthSlots\.map|createPortal\(/);
  assert.match(surface,/const \[surfaceMarkup\] = useState\(\(\) => \(\{ __html: graphServerHtml \}\)\)/);
  assert.match(surface,/ref=\{graphHtmlHost\} dangerouslySetInnerHTML=\{surfaceMarkup\}/);
  assert.match(surface,/const \[healthSlots, setHealthSlots\] = useState<HTMLElement\[\]>\(\[\]\)/);
  assert.match(surface,/setHealthSlots\(Array\.from\(host\.querySelectorAll<HTMLElement>\("\[data-maestro-health-slot\]"\)\)\)/);
  assert.match(surface,/\}, \[\]\);\s*\/\/ Live status colors/);
  assert.match(surface,/createPortal\(<GraphServerStatusHistory/);
  assert.doesNotMatch(surface,/slot\.isConnected|\.innerHTML\s*=|\.replaceChildren\(/);
});
test('Perspective health updates retain the markup object and new mounts acquire new slots',()=>{
  // A hook/JSX contract fixture, not a browser or React reconciliation test.
  const view=source('src/canvas/tab/view/view-components.tsx');
  const file=ts.createSourceFile('view-components.tsx',view,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declaration=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='PerspectiveHtmlSurface');
  assert.ok(declaration);
  const code=ts.transpileModule(declaration.getText(file)+'\nmodule.exports=PerspectiveHtmlSurface;',{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'jsx',jsxFragmentFactory:'fragment'},
    fileName:'surface.tsx',reportDiagnostics:true});
  assert.equal(code.diagnostics.length,0);
  function mount(markup,slot){
    const state=[],effects=[];let cursor=0;
    const m={exports:{}};
    vm.runInNewContext(code.outputText,{module:m,exports:m.exports,fragment:'fragment',GraphServerStatusHistory:'history',
      jsx:(type,props,...children)=>({type,props,children}),createPortal:(child,target,key)=>({child,target,key}),
      useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],value=>{state[i]=value;}];},
      useRef(initial){const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i];},
      useLayoutEffect(effect){effects.push(effect);}});
    const render=health=>{cursor=0;effects.length=0;return m.exports({graphServerHtml:markup,graphServerCards:[{uri:'urn:service',endpoint:'https://example.org/sparql',label:'Service',health}],selectedGraphCardUri:'',queryXml:'<query/>',canReadGraphHistory:true,kanbanActive:false});};
    const first=render('Checking');
    const firstHost=first.children[0];firstHost.props.ref.current={querySelectorAll:selector=>selector==='[data-maestro-health-slot]'?[slot]:[]};
    effects[0]();
    return {firstHost,render};
  }
  const oldSlot={dataset:{maestroHealthSlot:'urn:service'}},newSlot={dataset:{maestroHealthSlot:'urn:service'}};
  const first=mount('<article>Page 1</article>',oldSlot);
  const update=first.render('Healthy');
  assert.equal(update.children[0].props.dangerouslySetInnerHTML,first.firstHost.props.dangerouslySetInnerHTML);
  assert.equal(update.children[1][0].target,oldSlot);
  const second=mount('<article>Page 2</article>',newSlot);
  const next=second.render('Healthy');
  assert.notEqual(next.children[0].props.dangerouslySetInnerHTML,first.firstHost.props.dangerouslySetInnerHTML);
  assert.equal(next.children[0].props.dangerouslySetInnerHTML.__html,'<article>Page 2</article>');
  assert.equal(next.children[1][0].target,newSlot);
});

test('genuine HTTP 400 is saved as degraded RDF evidence and remains amber for its day after recovery',async()=>{
 const f=fixture(),endpoint='https://personal.example/sparql',at=Date.parse('2026-11-24T12:00:00Z');
 await f.api.recordGraphServerStatusObservation(endpoint,{state:'degraded',status:400},at);
 await f.api.recordGraphServerStatusObservation(endpoint,{state:'ok',status:200},at+1);
 assert.match(f.updates[0],/healthState> "degraded"/);assert.match(f.updates[0],/httpStatus> "400"/);
 assert.equal(f.events.length,2);assert.equal(f.api.graphStatusDaily([{created:new Date(at).toISOString(),state:'degraded',status:400},{created:new Date(at+1).toISOString(),state:'ok',status:200}])[0].value,2);
});
