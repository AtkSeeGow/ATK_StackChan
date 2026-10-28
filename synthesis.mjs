// One manual playback job; PCM and text are never persisted.
export class SynthesisPlayback {
  constructor(url,token,now=Date.now){this.url=url?.replace(/\/$/,'') || '';this.token=token || '';this.now=now;this.job={id:'',status:'idle',error:'',requestedAt:0};this.pcm=null;}
  get configured(){return !!this.url && this.token.length>=32;}
  snapshot(){
    if(this.busy && this.now()-this.job.requestedAt>(this.job.status==='queued'?15000:this.job.status==='synthesizing'?180000:Math.max(60000,(this.job.seconds||0)*1000+30000))) this.finish('timeout');
    return {...this.job,configured:this.configured};
  }
  get busy(){return ['synthesizing','queued','downloading','playback'].includes(this.job.status);}
  finish(status,error=''){this.job.status=status;this.job.error=error;this.pcm=null;}
  async prepare(text,outputGain=8){
    const isolated=new SynthesisPlayback(this.url,this.token,this.now);
    await isolated.start('preparing',text,208,outputGain,'timer-preparation');
    if(isolated.job.status!=='queued'||!isolated.pcm)throw new Error('預備語音合成失敗。');
    const pcm=isolated.pcm;isolated.pcm=null;return pcm;
  }
  enqueuePrepared(id,pcm,volume=208,outputGain=8,source='timer-prepared'){
    this.snapshot();if(this.busy)throw new Error('上一段語音仍在播放。');
    if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2||pcm.length>4194304)throw new Error('預備音訊無效。');
    this.pcm=pcm;this.job={id,status:'queued',error:'',requestedAt:this.now(),volume,outputGain,source,seconds:pcm.length/34000};
  }
  async start(id,text,volume,outputGain,source='manual'){
    this.snapshot();
    if(this.busy)throw new Error('上一段語音仍在播放或合成。');
    if(!this.configured)throw new Error('尚未設定語音服務。');
    if(typeof text!=='string' || !text.trim() || text.length>200)throw new Error('朗讀文字需介於 1～200 字。');
    if(!Number.isInteger(volume)||volume<32||volume>255||![4,8].includes(outputGain))throw new Error('播放音量設定不正確。');
    this.job={id,status:'synthesizing',error:'',requestedAt:this.now(),volume,outputGain,source};
    try{
      const response=await fetch(this.url+'/synthesize',{method:'POST',redirect:'error',signal:AbortSignal.timeout(180000),headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({text:text.trim()})});
      if(response.status===422){this.finish('failed','音訊超過裝置記憶體容量，請縮短文字。');return;}
      if(!response.ok)throw new Error('合成服務失敗。');
      if(response.headers.get('x-audio-sample-rate')!=='17000'||response.headers.get('x-audio-channels')!=='1'||response.headers.get('x-audio-bits')!=='16')throw new Error('合成音訊格式不正確。');
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>4194304)throw new Error('音訊超過裝置記憶體容量，請縮短文字。');chunks.push(chunk);}
      const pcm=Buffer.concat(chunks);
      if(!pcm.length||pcm.length%2)throw new Error('合成音訊不完整。');
      let peak=0;for(let i=0;i<pcm.length;i+=2)peak=Math.max(peak,Math.abs(pcm.readInt16LE(i)));
      if(!peak)throw new Error('合成音訊沒有聲音。');
      // Preserve speech dynamics, with the same peak ceiling used by device replay.
      const scale=Math.min(1,(outputGain===8?14000:20000)/peak);
      for(let i=0;i<pcm.length/2;i++){const fade=Math.min(1,i/170,(pcm.length/2-1-i)/170);pcm.writeInt16LE(Math.round(pcm.readInt16LE(i*2)*scale*fade),i*2);}
      if(this.job.status!=='synthesizing')return;
      this.pcm=pcm;this.job.status='queued';this.job.requestedAt=this.now();this.job.seconds=pcm.length/34000;
    }catch{this.finish('failed','無法合成語音，請檢查服務或縮短文字。');}
  }
  take(id){
    this.snapshot();
    if(id!==this.job.id||this.job.status!=='queued'||!this.pcm)throw new Error('播放指令已過期或重複。');
    const pcm=this.pcm;this.pcm=null;this.job.status='downloading';return pcm;
  }
  report(report){
    this.snapshot();
    if(report.id!==this.job.id)return false;
    if(this.job.status==='queued'&&['download_failed','allocation_failed'].includes(report.status)){this.finish('failed','裝置下載失敗，請重試。');return true;}
    if(!['downloading','playback'].includes(this.job.status))return false;
    if(report.status==='playback'&&this.job.status==='downloading')this.job.status='playback';
    else if(report.status==='completed')this.finish('completed');
    else if(['allocation_failed','playback_failed','download_failed','timeout'].includes(report.status))this.finish('failed','裝置播放失敗，請重試。');
    else return false;
    return true;
  }
}
