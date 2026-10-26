import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interactionState,timerCue,timerVoiceContext,timerLineRelevant} from '../interaction.mjs';

const base={speech:{status:'idle'},synthesis:{status:'idle'},audio:{status:'idle',requestedAt:0},device:{connected:true,transport:'wifi'},camera:{enabled:false}};

test('interaction exposes one coordinated listen/speak state',()=>{
  assert.deepEqual(interactionState(base),{mode:'ready',label:'準備聽你說話，也可以讓角色回應',canListen:true,canSpeak:true,cameraPaused:true,requiresChatConfirmation:true});
  assert.equal(interactionState({...base,synthesis:{status:'playback'}}).mode,'speaking');
  assert.equal(interactionState({...base,speech:{status:'recording'}}).canSpeak,false);
  assert.equal(interactionState({...base,speech:{status:'completed'}}).mode,'review');
  assert.equal(interactionState({...base,speech:{status:'timeout'}}).mode,'needs_attention');
  assert.equal(interactionState({...base,device:{connected:true,transport:'wifi',applied:{audioReady:false}}}).canListen,false);
  assert.equal(interactionState({...base,characterBusy:true}).mode,'thinking');
});

test('dynamic timer context includes real state and recent lines without weather claims',()=>{
  const context=JSON.parse(timerVoiceContext({action:'completed',phase:'focus',todayCompleted:3,presence:'present',now:Date.parse('2026-10-25T01:00:00Z'),recent:['前一句']}));
  assert.equal(context.todayCompleted,3);assert.equal(context.event,'completed');assert.deepEqual(context.recentLines,['前一句']);
  assert.equal(Object.hasOwn(context,'weather'),false);
  const resumed=JSON.parse(timerVoiceContext({action:'resume',phase:'focus',todayCompleted:0,presence:'present'}));
  assert.match(resumed.eventMeaning,/暫停.*繼續/);assert.match(resumed.eventMeaning,/不能.*第一次開始/);
});

test('timer cues keep phase, line and expression together',()=>{
  assert.equal(timerCue('start','focus').expression,'teasing');
  assert.match(timerCue('resume','focus').text,/回來|接著|繼續/);
  assert.match(timerCue('completed','focus').text,/做完/);
  assert.equal(timerCue('start','break').expression,'concerned');
  assert.equal(timerCue('reset','focus'),null);
});

test('timer speech names the actual phase and event using Taiwanese wording',()=>{
  for(const phase of ['focus','break'])for(const action of ['start','resume','completed'])assert.equal(timerLineRelevant(timerCue(action,phase).text,action,phase),true);
  assert.equal(timerLineRelevant('休息時間開始啦，喝口水吧。','start','focus'),false);
  assert.equal(timerLineRelevant('專注時間開始囉。','completed','focus'),false);
  assert.equal(timerLineRelevant('專注做完囉，辛苦啦！','completed','focus'),true);
  assert.equal(timerLineRelevant('休息時間開始，咱們摸魚吧。','start','break'),false);
  assert.equal(timerLineRelevant('這波專注的繼續，辛苦啦。','resume','focus'),false);
});
