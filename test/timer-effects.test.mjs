import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimerEffects } from '../timer-effects.mjs';

const running=(seconds)=>({timer:{phase:'focus',status:'running',remainingMs:seconds*1000,startedAt:1,deadline:32000}});

test('timer effects issue one-shot action cues and clear only matching acknowledgements',()=>{
  const effects=new TimerEffects();effects.action('start',1000);
  const cue=effects.current({timerLights:true,timerMotion:true},1001);
  assert.match(cue.id,/^[0-9a-f]{8}$/);assert.equal(cue.code,'g');assert.equal(cue.flags,3);
  effects.acknowledge('ffffffff');assert.equal(effects.current({timerLights:true,timerMotion:true},1002).id,cue.id);
  effects.acknowledge(cue.id);assert.deepEqual(effects.current({timerLights:true,timerMotion:true},1003),{flags:3,id:'00000000',code:'n'});
});

test('30 second warning occurs only while crossing the threshold in the same focus timer',()=>{
  const effects=new TimerEffects();effects.observe(running(31),1000);effects.observe(running(30),2000);
  assert.equal(effects.current({timerLights:true,timerMotion:false},2001).code,'w');
  const restarted=new TimerEffects();restarted.observe(running(25),1000);
  assert.equal(restarted.current({timerLights:true,timerMotion:true},1001).code,'n');
});

test('stale cues expire and feature flags are independent',()=>{
  const effects=new TimerEffects();effects.action('completed',1000);
  assert.deepEqual(effects.current({timerLights:false,timerMotion:true},16001),{flags:2,id:'00000000',code:'n'});
});
