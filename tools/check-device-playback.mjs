// Plays a fixed synthetic sentence on the device. Logs metadata only; no audio files.
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3000/api/';
const state=()=>fetch(base+'state').then(r=>r.json());
const before=await state();assert.ok(before.device.connected,'Wi-Fi device is offline');
const started=Date.now();
const response=await fetch(base+'synthesis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'play',text:'你好，現在開始專注時間。',volume:208,outputGain:8})});
assert.equal(response.status,202,await response.text());
const transitions=[];let current,playbackReportedMs=null;
for(let i=0;i<120;i++){
 await new Promise(r=>setTimeout(r,500));current=await state();const status=current.synthesis.status;
 if(transitions.at(-1)?.status!==status)transitions.push({status,elapsedMs:Date.now()-started});
 if(status==='playback' && playbackReportedMs===null)playbackReportedMs=Date.now()-started;
 if(['completed','failed','timeout'].includes(status))break;
}
assert.equal(current.synthesis.status,'completed',current.synthesis.error || 'Device playback did not complete');
assert.notEqual(current.synthesis.id,before.synthesis?.id,'Repeat playback reused an old command id');
assert.ok(current.device.connected,'Wi-Fi ACK missing after playback');
assert.ok(current.device.lastAck>before.device.lastAck,'No new display acknowledgement');
console.log(JSON.stringify({verified:true,transitions,playbackReportLatencyMs:playbackReportedMs,totalMs:Date.now()-started,wifiConnected:current.device.connected,displayAckAdvanced:true,timerStatusBefore:before.timer.status,timerStatusAfter:current.timer.status,acousticQualityVerified:false}));
