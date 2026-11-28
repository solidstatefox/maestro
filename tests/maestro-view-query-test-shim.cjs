/** The isolated transport VM loads without dependencies. This stub models the
 * public invoked-view contract; the production app uses XState v5 directly. */
const initial = { tab:"browse", viewPanel:"perspectives", viewProvider:null,
  selectedViewUri:"", selectedAnalysisUri:"", histogram:false };
function owner(selection){
  if(selection.tab==="browse")return {key:"browse",tab:"browse",ribbon:"browse"};
  if(selection.tab==="view"){
    const ribbon=selection.viewPanel==="providers"?`providers:${selection.viewProvider||"catalog"}`:
      selection.viewPanel==="perspectives"?`perspectives:${selection.selectedViewUri||"default"}`:"trail";
    return {key:`view:${ribbon}`,tab:"view",ribbon};
  }
  const ribbon=`${selection.selectedAnalysisUri||"default"}${selection.histogram?":histogram":""}`;
  return {key:`analyze:${ribbon}`,tab:"analyze",ribbon};
}
const offstage=()=>new DOMException('View actor inactive','AbortError');
module.exports={
  maestroOffstageError:offstage,
  createMaestroQueryViewCoordinator(){
    let selection={...initial},active=owner(selection),generation=0,cancelled=false,stopped=false;
    const controllers=new Set(),listeners=new Set();
    const emit=()=>{for(const cb of listeners)cb()};
    const abort=()=>{for(const c of controllers)c.abort();controllers.clear()};
    const snapshot=()=>({context:{selection,owner:active,generation,cancelled}});
    return {
      start(){stopped=false;emit()},getSnapshot:snapshot,getActive:()=>active,getSelection:()=>selection,getGeneration:()=>generation,
      subscribe(cb){listeners.add(cb);return()=>listeners.delete(cb)},
      select(next){const updated=owner(next),changed=updated.key!==active.key;selection={...next};
        if(changed){abort();active=updated;generation++}emit();return changed},
      cancel(){cancelled=true;abort();emit()},resume(){cancelled=false;generation++;emit()},
      stop(){stopped=true;abort();emit()},
      execute(scope,run,signal){
        const claimed=scope.tab==='browse' && scope.ribbon==='browse' ? 'browse' : `${scope.tab}:${scope.ribbon}`;
        if(stopped||cancelled||signal?.aborted||claimed!==active.key)return Promise.reject(offstage());
        const c=new AbortController();controllers.add(c);
        const onAbort=()=>c.abort();signal?.addEventListener('abort',onAbort,{once:true});
        return new Promise((resolve,reject)=>{
          const abortOne=()=>reject(offstage());c.signal.addEventListener('abort',abortOne,{once:true});
          Promise.resolve().then(()=>{if(c.signal.aborted)throw offstage();return run(c.signal)}).then(result=>{
            if(c.signal.aborted)reject(offstage());else resolve(result);
          },reject).finally(()=>{controllers.delete(c);signal?.removeEventListener('abort',onAbort);});
        });
      },
    };
  },
};
