import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DeviceTimerControl} from '../device-timer-control.mjs';
import {newState,defaults,timerAction} from '../core.mjs';

test('touch commands apply once, reject stale state and reject reused IDs with changed actions',()=>{
  const control=new DeviceTimerControl(),state=newState();let calls=0;
  const run=action=>{calls++;timerAction(state,defaults,action);};
  const context=()=>({session:'12345678',timer:state.timer,run});
  const start={id:'aaaaaaaa',session:'12345678',phase:'focus',status:'idle',action:'start'};
  assert.equal(control.apply(start,context()),'C|aaaaaaaa|ok');
  assert.equal(state.timer.status,'running');
  assert.equal(control.apply(start,context()),'C|aaaaaaaa|ok');assert.equal(calls,1);
  assert.equal(control.apply({...start,action:'reset'},context()),'C|aaaaaaaa|invalid');
  assert.equal(control.apply({...start,id:'bbbbbbbb'},context()),'C|bbbbbbbb|stale');
  assert.equal(control.apply({...start,id:'cccccccc',status:'running',action:'pause'},context()),'C|cccccccc|ok');
  assert.equal(state.timer.status,'paused');
  assert.equal(control.apply({...start,id:'dddddddd',status:'paused',session:'87654321',action:'reset'},context()),'C|dddddddd|stale');
  assert.equal(control.apply({...start,id:'eeeeeeee',status:'paused',action:'switch'},context()),'C|eeeeeeee|rejected');
  assert.equal(state.timer.phase,'focus');
});

test('invalid commands and busy motor leave timer unchanged',()=>{
  const control=new DeviceTimerControl(),state=newState();
  const context={session:'12345678',timer:state.timer,run:()=>{throw Error('busy');}};
  const message={id:'aaaaaaaa',session:'12345678',phase:'focus',status:'idle',action:'start'};
  assert.equal(control.apply({...message,id:'wrong'},context),null);
  assert.equal(control.apply({...message,action:'motor'},context),'C|aaaaaaaa|invalid');
  assert.equal(control.apply({...message,id:'bbbbbbbb'},context),'C|bbbbbbbb|rejected');
  assert.equal(state.timer.status,'idle');
});

test('nextStart touch retry cannot start or switch the following phase twice',()=>{
  const state=newState();state.timer.status='completed';state.timer.remainingMs=0;
  const control=new DeviceTimerControl();
  const message={id:'aaaaaaaa',session:'12345678',phase:'focus',status:'completed',action:'nextStart'};
  const context={session:'12345678',timer:state.timer,run:action=>timerAction(state,defaults,action,1000)};
  assert.equal(control.apply(message,context),'C|aaaaaaaa|ok');assert.equal(state.timer.phase,'break');
  assert.equal(state.timer.status,'running');const deadline=state.timer.deadline;
  assert.equal(control.apply(message,context),'C|aaaaaaaa|ok');assert.equal(state.timer.deadline,deadline);
});
