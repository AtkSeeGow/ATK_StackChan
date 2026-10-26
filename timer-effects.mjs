import { randomBytes } from 'node:crypto';

const cueForAction = new Map([['start','g'],['resume','g'],['completed','d']]);

export class TimerEffects {
  constructor(){this.pending=null;this.timerKey='';this.lastRemaining=null;}
  trigger(code,now=Date.now()){
    if(['g','w','d'].includes(code))this.pending={id:randomBytes(4).toString('hex'),code,createdAt:now};
  }
  action(action,now=Date.now()){const code=cueForAction.get(action);if(code)this.trigger(code,now);}
  observe(state,now=Date.now()){
    const timer=state.timer,remaining=Math.max(0,Math.ceil((timer.status==='running'?timer.deadline-now:timer.remainingMs)/1000));
    const key=timer.status==='running'?`${timer.phase}:${timer.startedAt??''}:${timer.deadline??''}`:'';
    if(!key){this.timerKey='';this.lastRemaining=null;return;}
    if(key!==this.timerKey){this.timerKey=key;this.lastRemaining=remaining;return;}
    if(timer.phase==='focus'&&this.lastRemaining>30&&remaining<=30)this.trigger('w',now);
    this.lastRemaining=remaining;
  }
  current(settings,now=Date.now()){
    if(this.pending&&now-this.pending.createdAt>15000)this.pending=null;
    return {flags:(settings.timerLights?1:0)|(settings.timerMotion?2:0),id:this.pending?.id||'00000000',code:this.pending?.code||'n'};
  }
  acknowledge(id){if(this.pending?.id===id)this.pending=null;}
}
