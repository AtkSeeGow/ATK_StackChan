// Metadata-only checks. JPEG pixels are neither saved nor displayed.
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3000/api/';
async function state(){return fetch(base+'state').then(r=>r.json());}
async function control(action){const r=await fetch(base+'camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});assert.equal(r.status,200);return r.json();}
const before=await state(); assert.equal(before.device.transport,'wifi');
await control('stop');
await new Promise(r=>setTimeout(r,8500));
let stopped=await state(); assert.equal(stopped.camera.enabled,false);assert.equal(stopped.camera.fresh,false);
assert.equal((await fetch(base+'camera/frame')).status,404);
await control('start');
let first=0, result;
for(let i=0;i<20;i++){
 await new Promise(r=>setTimeout(r,1000));result=await state();
 if(result.camera.fresh && !first) first=result.camera.seq;
 if(first && result.camera.seq>=first+2) break;
}
assert.ok(result.camera.fresh);assert.ok(result.camera.seq>=first+2);assert.ok(result.device.connected);
assert.equal(result.timer.phase,before.timer.phase);assert.equal(result.timer.status,before.timer.status);
console.log(JSON.stringify({verified:true,stopClearedPreview:true,restartedFrames:result.camera.seq-first+1,wifiConnected:result.device.connected,presence:result.camera.presence}));
