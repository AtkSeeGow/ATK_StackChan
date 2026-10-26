export class DeviceTimerControl {
  constructor(){this.results=new Map();}
  apply(message,{session,timer,run}){
    const {id,action,phase,status}=message;
    if(!/^[0-9a-f]{8}$/.test(id??''))return null;
    const key=`${message.session}:${id}`,fingerprint=JSON.stringify([action,phase,status]);
    const previous=this.results.get(key);
    if(previous)return previous.fingerprint===fingerprint?previous.result:`C|${id}|invalid`;
    let code='ok';
    if(message.session!==session||phase!==timer.phase||status!==timer.status)code='stale';
    else if(!['start','pause','resume','reset','switch','next','nextStart'].includes(action))code='invalid';
    else {try{run(action);}catch{code='rejected';}}
    const result=`C|${id}|${code}`;
    this.results.set(key,{fingerprint,result});
    if(this.results.size>64)this.results.delete(this.results.keys().next().value);
    return result;
  }
}
