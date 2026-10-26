import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PreparedTimerVoice} from '../prepared-timer-voice.mjs';

test('preparation happens ahead of playback and cached PCM is consumed once',async()=>{
  const cache=new PreparedTimerVoice();let calls=0;
  const entry=cache.ensure('start-focus',async()=>{calls++;return {text:'專注開始囉',pcm:Buffer.from([1,2])};});
  assert.equal(cache.ensure('start-focus',()=>{throw Error('duplicate');}),entry);
  await entry.promise;assert.equal(calls,1);assert.equal(cache.snapshot()[0].status,'ready');
  assert.equal(cache.take('start-focus').text,'專注開始囉');assert.equal(cache.take('start-focus'),null);
});

test('reset invalidates in-flight output; preparation jobs are serialized',async()=>{
  const cache=new PreparedTimerVoice();let release;let active=0,maximum=0;
  const first=cache.ensure('old',async()=>{maximum=Math.max(maximum,++active);await new Promise(resolve=>release=resolve);active--;return {pcm:Buffer.alloc(2)};});
  await Promise.resolve();cache.clear();
  const second=cache.ensure('new',async()=>{maximum=Math.max(maximum,++active);active--;return {text:'休息開始啦'};});
  release();await first.promise;await second.promise;
  assert.equal(cache.take('old'),null);assert.equal(maximum,1);assert.equal(cache.take('new').text,'休息開始啦');
});

test('preparing next phase cannot evict audio currently needed by an event',async()=>{
  const cache=new PreparedTimerVoice();let release;
  const current=cache.ensure('current-end',async()=>{await new Promise(resolve=>release=resolve);return {text:'專注結束囉'};});
  current.pinned=true;await Promise.resolve();
  for(let i=0;i<4;i++)cache.ensure(`next-${i}`,async()=>({text:'休息開始啦'}));
  assert.equal(cache.get('current-end'),current);
  release();await current.promise;assert.equal(cache.take('current-end').text,'專注結束囉');
});
