import {randomBytes} from 'node:crypto';

export class MotorControl {
  constructor(){this.previewCenter=null;this.job={id:'',status:'idle',degrees:15,mode:'sweep',requestedAt:0,error:''};}
  get busy(){this.snapshot();return ['queued','running'].includes(this.job.status);}
  start(degrees,now=Date.now()){
    if(!Number.isInteger(degrees)||degrees<5||degrees>30)throw new Error('水平幅度請設定為 5～30 度的整數。');
    if(this.busy)throw new Error('馬達正在執行上一個動作。');
    this.job={id:randomBytes(4).toString('hex'),status:'queued',mode:'sweep',degrees,requestedAt:now,error:''};
  }
  center(offset,now=Date.now()){
    if(!Number.isInteger(offset)||Math.abs(offset)>15)throw new Error('居中偏移限於 −15°～＋15°。');
    if(this.busy)throw new Error('請等上一個動作結束。');
    this.job={id:randomBytes(4).toString('hex'),status:'queued',mode:'center',degrees:0,centerOffset:offset,requestedAt:now,error:''};
  }
  report(value){
    if(!this.busy||value.id!==this.job.id||!['running','completed','failed'].includes(value.status))return false;
    if(value.status==='completed'&&(value.power!=='off'||value.pitch_torque!=='off'||value.motion_verified!==false))return false;
    if(value.status==='completed'&&this.job.mode==='center'&&value.center_offset!==this.job.centerOffset)return false;
    this.job={...this.job,status:value.status,error:value.status==='failed'?'裝置忙碌或動作未完整完成，請檢查裝置。':'',power:value.power||null};
    if(value.status==='completed'&&this.job.mode==='center')this.previewCenter=this.job.centerOffset;
    return true;
  }
  snapshot(now=Date.now()){
    if(['queued','running'].includes(this.job.status)&&now-this.job.requestedAt>60000)this.job={...this.job,status:'timeout',error:'動作回報逾時，請先確認裝置已停止。'};
    return {...this.job};
  }
}
