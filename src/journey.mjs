// Durations are measured within one process, never by subtracting wall clocks across resumes.
export async function measurePhase(records,phase,operation,{leaf=true,clock=()=>performance.now(),utc=()=>new Date().toISOString()}={}){
 const record={phase,start_at:utc(),end_at:null,duration_ms:null,status:'RUNNING',leaf};records.push(record);const start=clock();
 try{const result=await operation();record.status='COMPLETED';return result;}catch(error){record.status=error.name==='AbortError'?'INTERRUPTED':'FAILED';throw error;}
 finally{record.duration_ms=Math.max(0,clock()-start);record.end_at=utc();}
}
export function journeyMetrics(records,{verified=false,applied=false,request_ms=null,verified_ms=null,applied_ms=null}={}){return {phases:records,leaf_duration_ms:records.some(r=>r.leaf&&r.duration_ms===null)?null:records.filter(r=>r.leaf).reduce((n,r)=>n+r.duration_ms,0),time_to_verified_candidate:verified&&verified_ms!==null&&request_ms!==null?verified_ms-request_ms:null,time_to_applied_fix:applied&&applied_ms!==null&&request_ms!==null?applied_ms-request_ms:null,active_human_review_ms:null,outer_chat_tokens:'excluded-unobservable'};}
