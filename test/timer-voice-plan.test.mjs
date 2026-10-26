import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timerVoicePlan,invalidatesTimerVoice} from '../timer-voice-plan.mjs';
import {PreparedTimerVoice} from '../prepared-timer-voice.mjs';

test('pause and resume audio are prepared before starting and during long timers',()=>{
  for(const phase of ['focus','break']){
    const idle=timerVoicePlan({status:'idle',phase});
    assert.deepEqual(idle.map(item=>item.action),['start','pause','resume','completed']);
    assert.ok(idle.every(item=>item.phase===phase));
    assert.deepEqual(timerVoicePlan({status:'running',phase,deadline:1000000},0).map(item=>item.action),['pause','resume']);
    assert.deepEqual(timerVoicePlan({status:'paused',phase}).map(item=>item.action),['resume','pause']);
  }
});

test('pause/resume preserve prepared audio; reset/switch invalidate it',()=>{
  assert.equal(invalidatesTimerVoice('pause'),false);
  assert.equal(invalidatesTimerVoice('resume'),false);
  assert.equal(invalidatesTimerVoice('reset'),true);
  assert.equal(invalidatesTimerVoice('switch'),true);
  assert.equal(timerVoicePlan({status:'completed',phase:'focus'})[0].phase,'break');
});

test('start then pause consumes audio that was already prepared, without rebuilding',async()=>{
  const cache=new PreparedTimerVoice();let builds=0;
  for(const {action,phase} of timerVoicePlan({status:'idle',phase:'focus'})){
    await cache.ensure(`${action}:${phase}`,async()=>{builds++;return {text:action,pcm:Buffer.alloc(2)};}).promise;
  }
  cache.take('start:focus');
  for(const {action,phase} of timerVoicePlan({status:'running',phase:'focus',deadline:1000000},0))cache.ensure(`${action}:${phase}`,()=>{throw Error('unexpected rebuild');});
  assert.equal(invalidatesTimerVoice('pause'),false);
  assert.equal(cache.get('pause:focus').status,'ready');
  assert.equal(cache.take('pause:focus').text,'pause');
  assert.equal(cache.get('resume:focus').status,'ready');
  assert.equal(builds,4);
});
