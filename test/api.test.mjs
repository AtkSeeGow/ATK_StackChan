import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';

test('HTTP integration: persistence, timer, origin protection, Ollama success/failure', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'stackchan-test-'));
  let calls = 0;
  const mock = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if(req.url==='/health') return res.end(JSON.stringify({ready:true,device:'mock',model:'mock'}));
    if(req.url==='/transcribe') {let bytes=0;for await(const chunk of req)bytes+=chunk.length;assert.equal(bytes,170044);return res.end(JSON.stringify({text:'這是測試辨識文字'}));}
    if(req.url==='/synthesize') {assert.equal(req.headers.authorization,'Bearer '+'b'.repeat(64));for await(const chunk of req){};res.setHeader('X-Audio-Sample-Rate','17000');res.setHeader('X-Audio-Channels','1');res.setHeader('X-Audio-Bits','16');const pcm=Buffer.alloc(34000);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(20000,i);return res.end(pcm);}
    if (req.url === '/api/version') return res.end(JSON.stringify({version:'test'}));
    if (req.url === '/api/tags') return res.end(JSON.stringify({models:[{name:'test:4b'}]}));
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls++;
    assert.equal(body.think, false); assert.equal(body.options.num_ctx, 4096);
    assert.ok(body.messages[0].content.includes('未知不等於離席'));
    const content = calls === 1 ? JSON.stringify({text:'雜魚，一起開始吧！',expression:'teasing'}) : 'invalid';
    res.end(JSON.stringify({message:{content},done_reason:'stop',total_duration:100000000}));
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  // Reserve an available local port, then use it for the child application.
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  async function start(extraEnv = {}) {
    child = spawn(process.execPath, ['server.mjs'], { cwd: path.resolve(import.meta.dirname, '..'), env: {...process.env, PORT:String(port),STACKCHAN_DATA_DIR:folder,STACKCHAN_SERIAL_PORT:'off',STACKCHAN_TRANSPORT:'usb',STACKCHAN_DEV_ORIGIN:'',STACKCHAN_PUBLIC_ORIGIN:'',...extraEnv}, stdio:['ignore','pipe','pipe'] });
    await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(new Error('server start timed out')), 10000);
      child.stdout.on('data', chunk => { if (chunk.toString().includes('ready:')) { clearTimeout(timeout); resolve(); } });
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', code => { clearTimeout(timeout); reject(new Error(`server exited ${code}`)); });
    });
  }
  async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
  const request = async (route, data) => {
    const res = await fetch(base + route, data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    return {status:res.status,body:await res.json()};
  };
  try {
    await start();
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base + '/api/state', {headers:{Origin:'http://evil.example'}})).status, 403);
    let s = (await request('/api/state')).body;
    assert.equal(s.presence, 'unknown');
    const config = {...s.settings, focusMinutes:1, absencePolicy:'pause', ollamaUrl:`http://127.0.0.1:${mock.address().port}`,model:'test:4b'};
    assert.equal((await request('/api/settings', config)).status, 200);
    assert.equal((await request('/api/health')).body.modelAvailable, true);
    await request('/api/timer', {action:'start'});
    s = (await request('/api/presence', {presence:'absent'})).body;
    assert.equal(s.timer.status, 'paused'); assert.equal(s.timer.pauseReason, 'absence');
    assert.equal((await request('/api/chat', {text:'你好'})).status, 200);
    assert.equal((await request('/api/messages')).body.length, 2);
    assert.equal((await request('/api/chat', {text:'第二次'})).status, 502);
    assert.equal((await request('/api/messages')).body.length, 2);
    assert.equal((await request('/api/state')).body.chatBusy, false);
    assert.equal((await request('/api/audio/settings',{volume:31,outputGain:8})).status,400);
    assert.equal((await request('/api/audio/settings',{volume:96,outputGain:6})).status,400);
    const audioSettings=await request('/api/audio/settings',{volume:96,outputGain:4});
    assert.equal(audioSettings.body.settings.audioVolume,96);
    assert.equal(audioSettings.body.settings.audioOutputGain,4);
    await request('/api/settings',config);
    await stop(); await start();
    const restoredAudio=(await request('/api/state')).body.settings;
    assert.equal(restoredAudio.audioVolume,96);
    assert.equal(restoredAudio.audioOutputGain,4);
    await request('/api/audio/settings',{volume:208,outputGain:8});
    s = (await request('/api/state')).body;
    assert.equal(s.settings.focusMinutes, 1); assert.equal(s.timer.status, 'paused');
    assert.equal((await request('/api/messages')).body.length, 2);
    assert.equal((await request('/api/camera',{action:'start'})).body.camera.enabled,true);
    assert.equal((await fetch(base+'/api/camera/frame')).status,404);
    s = (await request('/api/camera',{action:'source',source:'camera'})).body;
    assert.equal(s.presence,'unknown');
    s = (await request('/api/presence',{presence:'present'})).body;
    assert.equal(s.settings.presenceSource,'manual');
    assert.equal((await request('/api/camera',{action:'stop'})).body.camera.enabled,false);
    await stop();
    const token = 'b'.repeat(64), password = 'test-password-0123456789';
    await start({STACKCHAN_TRANSPORT:'wifi',STACKCHAN_DEVICE_TOKEN:token,STACKCHAN_PUBLIC_ORIGIN:'https://stackchan.test',STACKCHAN_WEB_USER:'owner',STACKCHAN_WEB_PASSWORD:password});
    const bearer = {Authorization:`Bearer ${token}`};
    const owner = {Authorization:`Basic ${Buffer.from(`owner:${password}`).toString('base64')}`};
    assert.equal((await fetch(base+'/api/state')).status,401);
    assert.equal((await fetch(base+'/api/state',{headers:bearer})).status,401);
    assert.equal((await fetch(base+'/api/device/frame',{headers:owner})).status,401);
    const frameResponse = await fetch(base+'/api/device/frame',{headers:bearer});
    assert.equal(frameResponse.status,200);
    const parts = (await frameResponse.text()).trim().split('|');
    const ack = {type:'sync_ack',protocol:2,session:parts[1],seq:Number(parts[2]),remaining_seconds:Number(parts[3]),expression:'teasing',status:'paused',effect_id:parts[9]};
    const postAck = () => fetch(base+'/api/device/ack',{method:'POST',headers:{...bearer,'Content-Type':'application/json'},body:JSON.stringify(ack)});
    assert.equal((await postAck()).status,200);
    assert.equal((await postAck()).status,409);
    const remoteState = await (await fetch(base+'/api/state',{headers:owner})).json();
    assert.equal(remoteState.device.transport,'wifi'); assert.equal(remoteState.device.connected,true);
    const motorRequest=data=>fetch(base+'/api/motor',{method:'POST',headers:{...owner,'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await motorRequest({action:'test',degrees:50})).status,400);
    const center=await(await motorRequest({action:'center',delta:-1})).json();
    assert.equal(center.motor.status,'queued');
    const centerFrame=await fetch(base+'/api/device/frame',{headers:bearer});
    assert.equal(centerFrame.headers.get('x-stackchan-motor-center'),'-1');
    assert.equal(centerFrame.headers.get('x-stackchan-motor-mode'),'center');
    assert.equal((await motorRequest({action:'center',delta:1})).status,400);
    const result=await fetch(base+'/api/device/audio',{method:'POST',headers:{...bearer,'Content-Type':'application/json'},body:JSON.stringify({type:'motor_result',id:center.motor.id,status:'completed',power:'off',pitch_torque:'off',motion_verified:false,center_offset:-1})});
    assert.equal(result.status,200);
    const centered=await(await motorRequest({action:'saveCenter'})).json();
    assert.equal(centered.settings.motorCenterOffset,-1);
    const savedAgain=await(await motorRequest({action:'saveCenter'})).json();
    assert.equal(savedAgain.motor.id,center.motor.id);
    assert.equal(savedAgain.motor.status,'completed');
    const afterSave=await fetch(base+'/api/device/frame',{headers:bearer});
    assert.equal(afterSave.headers.get('x-stackchan-motor'),'');
    assert.equal(afterSave.headers.get('x-stackchan-motor-center'),'-1');
    const idleActivity=afterSave.headers.get('x-stackchan-activity');
    await fetch(base+'/api/state',{headers:owner});
    const passive=await fetch(base+'/api/device/frame',{headers:bearer});
    assert.equal(passive.headers.get('x-stackchan-activity'),idleActivity);
    await fetch(base+'/api/activity',{method:'POST',headers:{...owner,'Content-Type':'application/json'},body:'{}'});
    const active=await fetch(base+'/api/device/frame',{headers:bearer});
    assert.notEqual(active.headers.get('x-stackchan-activity'),idleActivity);
    const proxyStatus = headers => new Promise((resolve,reject) => {
      http.get(base+'/api/state',{headers},res => {res.resume();resolve(res.statusCode);}).on('error',reject);
    });
    assert.equal(await proxyStatus({...owner,Host:'stackchan.test'}),403);
    assert.equal(await proxyStatus({...owner,Host:'stackchan.test','X-Forwarded-Proto':'https'}),200);
    await stop();
    await start({STACKCHAN_PUBLIC_ORIGIN:'http://stackchan.test',STACKCHAN_DEVICE_TOKEN:token,STACKCHAN_WEB_USER:'owner',STACKCHAN_WEB_PASSWORD:password});
    assert.equal(await proxyStatus({Host:'stackchan.test'}),401);
    assert.equal(await proxyStatus({...bearer,Host:'stackchan.test'}),401);
    assert.equal(await proxyStatus({...owner,Host:'stackchan.test'}),200);
    assert.equal(await proxyStatus({...owner,Host:'unexpected.test'}),403);
    const demoSocket=new WebSocket(`ws://127.0.0.1:${port}/api/live`,{headers:{...owner,Host:'stackchan.test',Origin:'http://stackchan.test'}});
    const demoMessage=once(demoSocket,'message');
    assert.ok(JSON.parse((await demoMessage)[0].toString()).timer);
    demoSocket.close();await once(demoSocket,'close');
    const deniedSocket=new WebSocket(`ws://127.0.0.1:${port}/api/live`,{headers:{Host:'stackchan.test',Origin:'http://stackchan.test'}});
    deniedSocket.on('error',()=>{});
    const [deniedRequest,deniedResponse]=await once(deniedSocket,'unexpected-response');
    assert.equal(deniedResponse.statusCode,403);deniedResponse.resume();deniedRequest.destroy();
    await stop();
    await start({STACKCHAN_PUBLIC_ORIGIN:'',STACKCHAN_DEV_ORIGIN:`http://192.168.0.199:${port}`,STACKCHAN_DEVICE_TOKEN:token});
    const devHost = {Host:`192.168.0.199:${port}`};
    assert.equal(await proxyStatus(devHost),403);
    const devGet = headers => new Promise((resolve,reject) => {
      http.get(base+'/api/device/frame',{headers},res => {res.resume();resolve(res.statusCode);}).on('error',reject);
    });
    assert.equal(await devGet(devHost),401);
    assert.equal(await devGet({...devHost,...bearer}),200);
    assert.equal(await devGet({...devHost,...bearer,Host:`192.168.0.200:${port}`}),403);
    assert.equal((await fetch(base+'/api/state')).status,200);
    const upload = (headers,bytes) => fetch(base+'/api/device/camera',{method:'POST',headers,body:bytes});
    const imageHeaders={...bearer,'Content-Type':'image/jpeg'};
    assert.equal((await upload({'Content-Type':'image/jpeg'},Buffer.alloc(100))).status,401);
    assert.equal((await upload(imageHeaders,Buffer.alloc(100))).status,409);
    await stop();
    await start({STACKCHAN_PUBLIC_ORIGIN:'',STACKCHAN_TRANSPORT:'wifi',STACKCHAN_DEV_ORIGIN:`http://192.168.0.199:${port}`,STACKCHAN_DEVICE_TOKEN:token});
    assert.equal((await request('/api/camera',{action:'start'})).status,200);
    assert.equal((await fetch(base+'/api/device/frame',{headers:bearer})).headers.get('x-stackchan-camera'),'1');
    assert.equal((await upload(bearer,Buffer.alloc(100))).status,415);
    assert.equal((await upload(imageHeaders,Buffer.alloc(100))).status,400);
    assert.equal((await upload(imageHeaders,Buffer.alloc(130001))).status,400);
    assert.equal((await request('/api/camera',{action:'stop'})).status,200);
    assert.equal((await fetch(base+'/api/device/frame',{headers:bearer})).headers.get('x-stackchan-camera'),'0');
    assert.equal((await request('/api/audio',{action:'test'})).status,400); // no fresh device ACK
    const audioFrame=(await (await fetch(base+'/api/device/frame',{headers:bearer})).text()).trim().split('|');
    await fetch(base+'/api/device/ack',{method:'POST',headers:{...bearer,'Content-Type':'application/json'},body:JSON.stringify({...ack,session:audioFrame[1],seq:Number(audioFrame[2]),remaining_seconds:Number(audioFrame[3])})});
    assert.equal((await request('/api/audio',{action:'test',volume:256})).status,400);
    assert.equal((await request('/api/audio',{action:'test',outputGain:16})).status,400);
    assert.equal((await request('/api/audio',{action:'test',volume:'208'})).status,400);
    await request('/api/audio/settings',{volume:96,outputGain:4});
    const audioTest=await request('/api/audio',{action:'test',volume:208});
    assert.equal(audioTest.status,200);assert.equal(audioTest.body.camera.enabled,false);
    assert.match(audioTest.body.audio.id,/^[a-f0-9]{8}$/);
    assert.equal(audioTest.body.audio.volume,96);
    assert.equal(audioTest.body.audio.outputGain,4);
    assert.equal((await fetch(base+'/api/device/frame',{headers:bearer})).headers.get('x-stackchan-volume'),'96');
    await request('/api/audio/settings',{volume:208,outputGain:8});
    assert.equal((await fetch(base+'/api/device/frame',{headers:bearer})).headers.get('x-stackchan-output-gain'),'4');
    assert.equal((await request('/api/audio',{action:'test'})).status,400);
    const reportAudio=data=>fetch(base+'/api/device/audio',{method:'POST',headers:{...bearer,'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await reportAudio({id:'00000000',status:'completed',peak:123,rms:23})).status,409);
    assert.equal((await reportAudio({id:audioTest.body.audio.id,status:'completed',peak:123,rms:23})).status,200);
    assert.equal((await request('/api/state')).body.audio.status,'completed');
    await stop();
    await start({STACKCHAN_PUBLIC_ORIGIN:'',STACKCHAN_TRANSPORT:'wifi',STACKCHAN_DEVICE_TOKEN:token});
    const speakerFrame=(await (await fetch(base+'/api/device/frame',{headers:bearer})).text()).trim().split('|');
    await fetch(base+'/api/device/ack',{method:'POST',headers:{...bearer,'Content-Type':'application/json'},body:JSON.stringify({...ack,session:speakerFrame[1],seq:Number(speakerFrame[2]),remaining_seconds:Number(speakerFrame[3])})});
    const speakerTest=await request('/api/audio',{action:'speaker',volume:208});
    assert.equal(speakerTest.status,200);assert.equal(speakerTest.body.audio.mode,'speaker');
    assert.equal((await fetch(base+'/api/device/frame',{headers:bearer})).headers.get('x-stackchan-audio-mode'),'speaker');
    await stop();
    await start({STACKCHAN_PUBLIC_ORIGIN:'',STACKCHAN_TRANSPORT:'wifi',STACKCHAN_DEVICE_TOKEN:token,STACKCHAN_STT_URL:`http://127.0.0.1:${mock.address().port}`,STACKCHAN_STT_TOKEN:token});
    const speechFrame=(await (await fetch(base+'/api/device/frame',{headers:bearer})).text()).trim().split('|');
    await fetch(base+'/api/device/ack',{method:'POST',headers:{...bearer,'Content-Type':'application/json'},body:JSON.stringify({...ack,session:speechFrame[1],seq:Number(speechFrame[2]),remaining_seconds:Number(speechFrame[3])})});
    const speechStart=await request('/api/speech',{action:'start'});assert.equal(speechStart.status,200);
    assert.equal(speechStart.body.audio.mode,'speech');const speechId=speechStart.body.speech.id;
    const uploadSpeech=(id,bytes,auth=bearer)=>fetch(base+'/api/device/speech',{method:'POST',headers:{...auth,'Content-Type':'application/octet-stream','X-StackChan-Audio-Id':id},body:bytes});
    assert.equal((await uploadSpeech(speechId,Buffer.alloc(170000),{})).status,401);
    assert.equal((await uploadSpeech('wrong-id',Buffer.alloc(170000))).status,409);
    assert.equal((await uploadSpeech(speechId,Buffer.alloc(5))).status,400);
    assert.equal((await uploadSpeech(speechId,Buffer.alloc(170000))).status,202);
    for(let i=0;i<20;i++){const result=(await request('/api/state')).body;if(result.speech.status==='completed')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal((await request('/api/state')).body.speech.text,'這是測試辨識文字');
    assert.equal((await uploadSpeech(speechId,Buffer.alloc(170000))).status,409);
    assert.equal((await request('/api/messages')).body.length,2); // no automatic chat submission
    await reportAudio({id:speechId,status:'completed',peak:0,rms:0});
    assert.equal((await request('/api/synthesis',{action:'play',text:'x'.repeat(201)})).status,400);
    const tts=await request('/api/synthesis',{action:'play',text:'你好',volume:208,outputGain:8});assert.equal(tts.status,202);
    const ttsId=tts.body.synthesis.id;
    for(let i=0;i<50;i++){if((await request('/api/state')).body.synthesis.status==='queued')break;await new Promise(r=>setTimeout(r,10));}
    const ttsFrame=await fetch(base+'/api/device/frame',{headers:bearer});
    assert.equal(ttsFrame.headers.get('x-stackchan-playback'),ttsId);
    assert.equal(ttsFrame.headers.get('x-stackchan-audio'),''); // Old firmware must never record on a TTS command.
    assert.equal((await request('/api/audio',{action:'test'})).status,400);
    assert.equal((await request('/api/speech',{action:'start'})).status,400);
    assert.equal((await request('/api/camera',{action:'start'})).status,400);
    assert.equal((await fetch(base+'/api/device/playback?id='+ttsId)).status,401);
    assert.equal((await fetch(base+'/api/device/playback?id=wrong',{headers:bearer})).status,409);
    const download=await fetch(base+'/api/device/playback?id='+ttsId,{headers:bearer});assert.equal(download.status,200);assert.equal((await download.arrayBuffer()).byteLength,34000);
    assert.equal((await fetch(base+'/api/device/playback?id='+ttsId,{headers:bearer})).status,409);
    assert.equal((await reportAudio({id:ttsId,status:'playback'})).status,200);
    assert.equal((await reportAudio({id:ttsId,status:'completed'})).status,200);
    assert.equal((await request('/api/state')).body.synthesis.status,'completed');
    assert.equal((await reportAudio({id:ttsId,status:'completed'})).status,409);
    assert.equal((await request('/api/messages')).body.length,2); // Manual playback does not add chat history.
    await request('/api/timer',{action:'reset'});
    const touchSocket=new WebSocket(base.replace('http:','ws:')+'/api/device/live',{headers:bearer});
    try{
      const [wire]=await once(touchSocket,'message');const session=wire.toString().split('|')[1];
      const timer=(await request('/api/state')).body.timer;
      const command={type:'timer_control',id:'1234abcd',session,phase:timer.phase,status:'idle',action:'start'};
      async function sendTouch(value){
        const result=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{touchSocket.off('message',listener);reject(Error('touch reply timeout'));},2000);function listener(data){if(data.toString().startsWith('C|')){clearTimeout(timeout);touchSocket.off('message',listener);resolve(data.toString());}}touchSocket.on('message',listener);});
        touchSocket.send(JSON.stringify(value));return result;
      }
      assert.equal(await sendTouch(command),'C|1234abcd|ok');
      const running=(await request('/api/state')).body.timer;assert.equal(running.status,'running');
      assert.equal(await sendTouch(command),'C|1234abcd|ok');
      assert.equal((await request('/api/state')).body.timer.deadline,running.deadline);
      assert.equal(await sendTouch({...command,id:'1234abce'}),'C|1234abce|stale');
      assert.equal(await sendTouch({...command,id:'1234abcf',status:'running',action:'pause'}),'C|1234abcf|ok');
      assert.equal((await request('/api/state')).body.timer.status,'paused');
    }finally{touchSocket.terminate();}
  } finally { await stop(); await new Promise(resolve => mock.close(resolve)); rmSync(folder, { recursive:true,force:true }); }
});
