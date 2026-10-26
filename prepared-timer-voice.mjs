// Only generated text/PCM live here; no microphone audio and no disk writes.
export class PreparedTimerVoice {
  constructor(){this.entries=new Map();this.tail=Promise.resolve();}
  ensure(key,producer){
    const existing=this.entries.get(key);
    if(existing&&!(existing.status==='failed'&&Date.now()-existing.failedAt>15000))return existing;
    const entry={status:'preparing',value:null};this.entries.set(key,entry);
    entry.promise=this.tail.then(async()=>{
      if(this.entries.get(key)!==entry)return null;
      try{
        const value=await producer();
        if(this.entries.get(key)!==entry)return null;
        entry.value=value;entry.status='ready';return value;
      }catch{entry.status='failed';entry.failedAt=Date.now();return null;}
    });
    this.tail=entry.promise.catch(()=>{});
    for(const old of this.entries.keys()){if(this.entries.size<=4)break;if(old!==key&&!this.entries.get(old).pinned)this.entries.delete(old);}
    return entry;
  }
  get(key){return this.entries.get(key);}
  take(key){const entry=this.entries.get(key);if(entry?.status!=='ready')return null;this.entries.delete(key);return entry.value;}
  clear(){this.entries.clear();}
  snapshot(){return [...this.entries.values()].map(entry=>({status:entry.status}));}
}
