export function pcmWave(pcm, rate = 17000) {
  if (!Buffer.isBuffer(pcm) || pcm.length !== rate*5*2) throw new Error('需要完整五秒單聲道錄音。');
  const header=Buffer.alloc(44); header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
  return Buffer.concat([header,pcm]);
}
export class SpeechService {
  constructor(url,token) {
    this.url=url?.replace(/\/$/,'') || ''; this.token=token || '';this.reset();
    if(this.url) { const u=new URL(this.url); if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash) throw new Error('Invalid speech service URL'); }
  }
  reset(){this.job={id:'',status:'idle',text:'',error:'',requestedAt:0};}
  get configured(){return !!this.url && this.token.length>=32;}
  snapshot(){
    if(['queued','recording'].includes(this.job.status) && Date.now()-this.job.requestedAt>30000) this.job.status='timeout';
    return {...this.job,configured:this.configured};
  }
  async health(){
    if(!this.configured) throw new Error('尚未設定語音辨識服務。');
    const r=await fetch(this.url+'/health',{headers:{Authorization:`Bearer ${this.token}`},signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!r.ok) throw new Error('語音辨識服務無法連線或認證失敗。');
    const h=await r.json();if(h.ready!==true) throw new Error('語音辨識模型尚未就緒。');return {connected:true,device:h.device,model:h.model};
  }
  start(id){
    if(['queued','recording','transcribing'].includes(this.snapshot().status)) throw new Error('上一段語音仍在處理。');
    this.job={id,status:'queued',text:'',error:'',requestedAt:Date.now()};
  }
  async accept(id,pcm){
    if(id!==this.job.id || !['queued','recording'].includes(this.snapshot().status)) throw new Error('錄音指令已過期或重複。');
    const wav=pcmWave(pcm);this.job.status='transcribing';
    try {
      const r=await fetch(this.url+'/transcribe',{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'audio/wav'},body:wav,signal:AbortSignal.timeout(120000),redirect:'error'});
      if(!r.ok) throw new Error(`語音辨識服務回傳 ${r.status}。`);
      const result=await r.json();if(typeof result.text!=='string'||result.text.length>2000) throw new Error('語音辨識回覆格式不正確。');
      this.job.text=result.text.trim();this.job.status=this.job.text ? 'completed' : 'empty';
    } catch(error){this.job.status='failed';this.job.error=error.name==='TimeoutError' ? '語音辨識逾時，請重試。' : '無法完成語音辨識，請檢查服務。';}
  }
}
