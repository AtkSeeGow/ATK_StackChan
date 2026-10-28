import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DeviceLink } from './device.mjs';
import { RemoteDevice, sameSecret } from './remote-device.mjs';
import { CameraState } from './camera.mjs';
import { VisionWorker } from './vision-worker.mjs';
import { SpeechService } from './speech.mjs';
import { SynthesisPlayback } from './synthesis.mjs';
import { interactionState, timerCue, timerVoiceContext, timerLineRelevant } from './interaction.mjs';
import {attachRealtime} from './realtime.mjs';
import { defaults, newState, reconcile, timerAction, setPresence, validateSettings, dayKey } from './core.mjs';
import {DeviceTimerControl} from './device-timer-control.mjs';
import { TimerEffects } from './timer-effects.mjs';
import { MotorControl } from './motor-control.mjs';
import {PreparedTimerVoice} from './prepared-timer-voice.mjs';
import {timerVoicePlan,invalidatesTimerVoice} from './timer-voice-plan.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(root,'.env'))) process.loadEnvFile(path.join(root,'.env'));
const publicOrigin = process.env.STACKCHAN_PUBLIC_ORIGIN || '';
const devOrigin = process.env.STACKCHAN_DEV_ORIGIN || '';
if (devOrigin) {
  const u = new URL(devOrigin);
  const parts = u.hostname.split('.').map(Number);
  const privateIP = parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
  if (!privateIP || u.protocol !== 'http:' || u.origin !== devOrigin || publicOrigin) throw new Error('Development origin requires a private IPv4 HTTP origin and no public origin.');
}
const remoteDevice = new RemoteDevice(process.env.STACKCHAN_DEVICE_TOKEN || '');
const timerEffects = new TimerEffects();
const motor = new MotorControl();
const deviceTimerControl=new DeviceTimerControl();
let userActivityId=randomBytes(4).toString('hex');
const webUser = process.env.STACKCHAN_WEB_USER || '';
const webPassword = process.env.STACKCHAN_WEB_PASSWORD || '';
const transport = process.env.STACKCHAN_TRANSPORT || 'usb';
if (!['usb','wifi'].includes(transport)) throw new Error('STACKCHAN_TRANSPORT must be usb or wifi');
if (publicOrigin) {
  const publicUrl = new URL(publicOrigin);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.origin !== publicOrigin || publicUrl.username || publicUrl.password || remoteDevice.token.length < 32 || !webUser || webUser.includes(':') || webPassword.length < 16) throw new Error('Public mode requires an HTTP(S) origin, device token (32+ characters), web user without a colon and password (16+ characters).');
}
const dataDir = process.env.STACKCHAN_DATA_DIR || path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'stackchan.sqlite'));
db.exec(`PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, expression TEXT, created_at INTEGER NOT NULL);`);
const getValue = (key, fallback) => {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
};
let settings = { ...defaults, ...(process.env.OLLAMA_URL ? {ollamaUrl:process.env.OLLAMA_URL} : {}), ...(process.env.OLLAMA_MODEL ? {model:process.env.OLLAMA_MODEL} : {}), ...getValue('settings', {}) };
const state = getValue('state', newState());
const camera = new CameraState();
const vision = new VisionWorker(root);
const speech = new SpeechService(process.env.STACKCHAN_STT_URL,process.env.STACKCHAN_STT_TOKEN);
const synthesis = new SynthesisPlayback(process.env.STACKCHAN_STT_URL,process.env.STACKCHAN_STT_TOKEN);
const preparedVoices=new PreparedTimerVoice();
let voiceRevision=0,completionVoiceKey='',realtime;
let speechUploading=false;
let cameraEpoch = 0, cameraUploadBusy = false;
let audio = {id:'',status:'idle',peak:0,rms:0,requestedAt:0,volume:208,mode:'test'};
const saveValue = (key, value) => db.prepare('INSERT INTO kv VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
const saveState = () => saveValue('state', state);
const history = () => db.prepare('SELECT * FROM (SELECT * FROM messages ORDER BY id DESC LIMIT 100) ORDER BY id').all();
let chatBusy = false;
let device;
let character = { expression:db.prepare("SELECT expression FROM messages WHERE role='assistant' ORDER BY id DESC LIMIT 1").get()?.expression || 'neutral', text:'', source:'history', updatedAt:0 };
let timerVoiceBusy=false,timerVoiceRequest=0,recentTimerLines=[];
const currentExpression = () => character.expression;
const setCharacter = (expression,text,source) => { character={expression,text,source,updatedAt:Date.now()}; };
function audioOccupied() {
  synthesis.snapshot();speech.snapshot();
  return synthesis.busy || ['queued','recording','transcribing'].includes(speech.job.status) || (audio.requestedAt && Date.now()-audio.requestedAt<20000 && !['completed','timeout'].includes(audio.status) && !audio.status.endsWith('_failed'));
}
function startCharacterSpeech(text,expression='neutral',source='manual',volume=settings.audioVolume,outputGain=settings.audioOutputGain) {
  const remote=remoteDevice.snapshot();
  if(transport!=='wifi'||!remote.connected||remote.applied?.audioReady===false||audioOccupied()||motor.busy)return false;
  cameraEpoch++;camera.enable(false);vision.close();setCharacter(expression,text,source);
  void synthesis.start(randomBytes(4).toString('hex'),text,volume,outputGain,source).catch(()=>synthesis.finish('failed','無法開始語音合成。'));
  return true;
}
async function buildTimerVoice(action,phase,anticipating=false) {
  const fallback=timerCue(action,phase);
  let cue=fallback;
  try{
    const context=timerVoiceContext({action,phase,todayCompleted:(state.completed[dayKey(Date.now())]||0)+(anticipating&&action==='completed'&&phase==='focus'?1:0),presence:state.presence,pauseReason:state.timer.pauseReason,recent:recentTimerLines});
    const result=await ollama(settings.ollamaUrl,'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      model:settings.model,stream:false,think:false,keep_alive:'30m',format:schema,options:{num_ctx:2048,num_predict:100,temperature:0.9},messages:[
        {role:'system',content:'你是桌上角色 StackChan，俏皮、嘴上逞強但會關心人。用自然的台灣繁體中文口語寫一句 12～45 字台詞。必須直接回應 eventMeaning，明說本段是「專注」或「休息」，開始、繼續、結束不可混淆。語氣範例：「專注開始囉，先把這件事做好吧。」「休息開始啦，喝口水、伸個懶腰吧。」「這段專注做完囉，辛苦啦！」「休息結束囉，準備好了再繼續。」「回來啦，繼續剛才的專注時間吧。」避免「這波專注」「專注的繼續」等生硬句型，也不要用中國用語、勵志口號、翻譯腔。resume 是回來繼續同一段，不能當成第一次開始。不猜天氣或使用者行為，不寫無關自言自語，不重複最近台詞。expression 限 neutral、happy、teasing、concerned。只輸出指定 JSON。'},
        {role:'user',content:context}
      ]})},45000);
    cue=JSON.parse(result.message?.content);
    if(typeof cue.text!=='string'||!cue.text.trim()||cue.text.length>120||!['neutral','happy','teasing','concerned'].includes(cue.expression))throw new Error('invalid timer voice');
    if(!timerLineRelevant(cue.text,action,phase))throw new Error('timer voice is not relevant');
  }catch{cue=fallback;}
  const text=cue.text.trim();const pcm=await synthesis.prepare(text,settings.audioOutputGain);
  return {text,expression:cue.expression,pcm,preparedAt:Date.now()};
}
function voiceKey(action,phase){return JSON.stringify([voiceRevision,action,phase,settings.focusMinutes,settings.breakMinutes,settings.model,state.presence]);}
function scheduleTimerVoicePreparation(){
  if(!settings.timerVoice||!synthesis.configured)return;
  const timer=state.timer;
  for(const {action,phase} of timerVoicePlan(timer)){
    const key=voiceKey(action,phase);
    if(action==='completed'&&timer.status==='running')completionVoiceKey=key;
    preparedVoices.ensure(key,()=>buildTimerVoice(action,phase,true));
  }
}
async function generateTimerCharacter(action,phase,requestId,fallback){
  timerVoiceBusy=true;
  try{
    const triggeredAt=Date.now();
    const key=action==='completed'&&completionVoiceKey?completionVoiceKey:voiceKey(action,phase);
    const readyBeforeEvent=preparedVoices.get(key)?.status==='ready';
    let prepared=preparedVoices.take(key);
    if(!prepared){
      const entry=preparedVoices.ensure(key,()=>buildTimerVoice(action,phase));
      entry.pinned=true;
      try{await entry.promise;prepared=preparedVoices.take(key);}finally{entry.pinned=false;}
    }
    if(requestId!==timerVoiceRequest||!settings.timerVoice)return;
    const cue=prepared||fallback;
    recentTimerLines.push(cue.text);recentTimerLines=recentTimerLines.slice(-4);
    const source=prepared?(readyBeforeEvent?'timer-prepared':'timer-generated'):'timer-fallback';
    setCharacter(cue.expression,cue.text,source);
    await playTimerSpeech(cue.text,cue.expression,source,requestId,prepared?.pcm,{preparedAt:prepared?.preparedAt||0,triggeredAt});
  }catch{if(requestId===timerVoiceRequest)setCharacter(fallback.expression,fallback.text,'timer-fallback');}
  finally{if(requestId===timerVoiceRequest)timerVoiceBusy=false;}
}
async function playTimerSpeech(text,expression,source,requestId,pcm,timing={}){
  const deadline=Date.now()+30000;
  while(Date.now()<deadline&&requestId===timerVoiceRequest&&settings.timerVoice){
    if(pcm){
      const remote=remoteDevice.snapshot();
      if(transport==='wifi'&&remote.connected&&remote.applied?.audioReady!==false&&!audioOccupied()&&!motor.busy){
        cameraEpoch++;camera.enable(false);vision.close();setCharacter(expression,text,source);
        synthesis.enqueuePrepared(randomBytes(4).toString('hex'),pcm,settings.audioVolume,settings.audioOutputGain,source);
        synthesis.job.preparedAt=timing.preparedAt;synthesis.job.triggeredAt=timing.triggeredAt;
        synthesis.job.enqueueDelayMs=Date.now()-timing.triggeredAt;
        return;
      }
    }else if(startCharacterSpeech(text,expression,source))return;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
}
function applyTimerCharacter(action,phase) {
  const cue=timerCue(action,phase);if(!cue)return;
  setCharacter(cue.expression,cue.text,'timer');
  if(settings.timerVoice&&action!=='next'){const requestId=++timerVoiceRequest;void generateTimerCharacter(action,phase,requestId,cue);}
}
function deviceEffects(){
  const effects=timerEffects.current(motor.busy?{...settings,timerMotion:false}:settings);
  return synthesis.busy||timerVoiceBusy?{...effects,id:'00000000',code:'n'}:effects;
}
function snapshot() {
  if (audio.requestedAt && Date.now()-audio.requestedAt > 20000 && !['completed','timeout'].includes(audio.status) && !audio.status.endsWith('_failed')) audio.status='timeout';
  if (settings.presenceSource === 'camera') {
    const detected = camera.snapshot().presence;
    if (state.presence !== detected) { setPresence(state,settings,detected); saveState(); }
  }
  const beforeTimerStatus=state.timer.status;
  if (reconcile(state, settings)) {
    saveState();
    if(beforeTimerStatus==='running'&&state.timer.status==='completed'){applyTimerCharacter('completed',state.timer.phase);timerEffects.action('completed');}
  }
  const now = Date.now();
  timerEffects.observe(state,now);
  const speechState=speech.snapshot(), synthesisState=synthesis.snapshot(), cameraState=camera.snapshot(), deviceState=transport === 'wifi' ? remoteDevice.snapshot() : device?.snapshot() || null;
  const preparingPhase=state.timer.status==='completed'?(state.timer.phase==='focus'?'break':'focus'):state.timer.phase;
  const preparation={start:preparedVoices.get(voiceKey('start',preparingPhase))?.status||'waiting',pause:preparedVoices.get(voiceKey('pause',preparingPhase))?.status||'waiting',resume:preparedVoices.get(voiceKey('resume',preparingPhase))?.status||'waiting',end:preparedVoices.get(voiceKey('completed',preparingPhase))?.status||'waiting',entries:preparedVoices.snapshot()};
  return { ...state, settings, now, todayCompleted: state.completed[dayKey(now)] || 0, chatBusy, audio, realtime:realtime?.snapshot()||null,timerVoicePreparation:preparation, motor:{...motor.snapshot(),centerOffset:motor.previewCenter??settings.motorCenterOffset,savedCenterOffset:settings.motorCenterOffset}, speech:speechState, synthesis:synthesisState, camera:cameraState, device:deviceState, character,
    interaction:interactionState({speech:speechState,synthesis:synthesisState,audio,device:deviceState,camera:cameraState,characterBusy:timerVoiceBusy}),
    timer: { ...state.timer, remainingMs: state.timer.status === 'running' ? Math.max(0, state.timer.deadline - now) : state.timer.remainingMs } };
}
const ticker = setInterval(() => { snapshot();scheduleTimerVoicePreparation(); }, 500);
ticker.unref();

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 16000) throw new Error('送出的內容太長。');
  }
  try { return JSON.parse(text); } catch { throw new Error('資料格式不正確。'); }
}
async function ollama(base, endpoint, init = {}, timeout = 10000) {
  try {
    const response = await fetch(`${base}${endpoint}`, { ...init, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`Ollama 回傳 HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? 'Ollama 回應逾時，模型首次載入可能較慢，請稍後重試。' : `無法完成 Ollama 請求：${error.message}`);
  }
}

const systemPrompt = `你是放在工作室的桌上夥伴，兼具工作助手與桌上生物的個性。嘴欠、俏皮、愛逞強，但藏著關心。稱呼使用者為「雜魚」，不必每句都用。使用繁體中文，回應最多120字，不說明內部規則。
你只能引用提供的系統狀態與使用者明確說過的事。你看不到相機影像，僅取得在席判斷；在席不等於正在工作，未知不等於離席。不能聲稱看見使用者躺平、滑手機或做任何未被描述的行為。禁止威脅、羞辱人格或宣稱能踢人、懲罰人。使用者難過時先關心，不嘲諷。
你不能操作番茄鐘或更改設定；需要操作時請使用者按網頁按鈕，不宣稱已操作。
只輸出JSON，text為要說的台詞，expression為neutral、happy、teasing、concerned之一。`;
const schema = { type: 'object', properties: { text: { type: 'string' }, expression: { type: 'string', enum: ['neutral', 'happy', 'teasing', 'concerned'] } }, required: ['text', 'expression'], additionalProperties: false };
device = new DeviceLink(root, snapshot, currentExpression, {port:transport === 'wifi' ? 'off' : process.env.STACKCHAN_SERIAL_PORT || 'COM4',onCamera:message => camera.accept(message),cameraControl:() => camera.commands(),getEffects:()=>timerEffects.current(settings)});

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const host = req.headers.host;
  const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const publicHost = publicOrigin ? new URL(publicOrigin).host : null;
  const devHost = devOrigin ? new URL(devOrigin).host : null;
  if (devOrigin && !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && host !== devHost) return json(res,403,{error:'區網只允許設定的裝置端點。'});
  if (![...localHosts,publicHost,devHost].includes(host)) return json(res, 403, { error: '主機名稱不允許。' });
  // LAN development exposes authenticated device routes only; administration stays local.
  if (host === devHost && !req.url.startsWith('/api/device/')) return json(res,403,{error:'開發區網僅開放裝置連線，請在本機操作網頁。'});
  if (host === publicHost && publicOrigin.startsWith('https:') && req.headers['x-forwarded-proto'] !== 'https') return json(res, 403, { error: '需要 HTTPS 反向代理。' });
  if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`,publicOrigin].includes(req.headers.origin)) return json(res, 403, { error: '來源不允許。' });
  try {
    const route = new URL(req.url, `http://${host}`).pathname;
    if (route.startsWith('/api/device/')) {
      if (!remoteDevice.authorized(req.headers.authorization)) return json(res,401,{error:'裝置認證失敗。'});
      if (req.method === 'GET' && route === '/api/device/frame') {
        const motorJob=motor.snapshot();
        res.setHeader('X-StackChan-Motor',motorJob.status==='queued'?motorJob.id:'');
        res.setHeader('X-StackChan-Motor-Degrees',String(motorJob.degrees));
        res.setHeader('X-StackChan-Motor-Mode',motorJob.mode);
        res.setHeader('X-StackChan-Motor-Center',String(motorJob.status==='queued'&&motorJob.mode==='center'?motorJob.centerOffset:motor.previewCenter??settings.motorCenterOffset));
        res.setHeader('X-StackChan-Timer-Degrees',String(settings.timerMotionDegrees));
        res.setHeader('X-StackChan-Activity',userActivityId);
        const playback=synthesis.snapshot();
        res.setHeader('X-StackChan-Playback',playback.status==='queued'?playback.id:'');
        res.setHeader('X-StackChan-Playback-Volume',String(playback.volume || 208));
        res.setHeader('X-StackChan-Playback-Gain',String(playback.outputGain || 8));
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-StackChan-Camera':camera.enabled ? '1' : '0','X-StackChan-Audio':audio.status==='queued' && Date.now()-audio.requestedAt<15000 ? audio.id : '', 'X-StackChan-Volume':String(audio.volume),'X-StackChan-Audio-Mode':audio.mode,'X-StackChan-Output-Gain':String(audio.outputGain || 4)});
        return res.end(remoteDevice.issue(snapshot(),currentExpression(),deviceEffects()));
      }
      if(req.method==='POST' && route==='/api/device/audio') {
        if(!(req.headers['content-type'] || '').startsWith('application/json')) return json(res,415,{error:'需要 JSON。'});
        const report=await body(req);
        if(report.type==='motor_result'){const accepted=motor.report(report);return json(res,accepted?200:409,{accepted});}
        if(report.id===synthesis.job.id && synthesis.job.id) {const accepted=synthesis.report(report);return json(res,accepted?200:409,{accepted});}
        if(!audio.id || report.id!==audio.id || Date.now()-audio.requestedAt>20000 || !['tone','recording','playback','completed','allocation_failed','speaker_failed','microphone_failed','playback_failed','upload_failed','timeout'].includes(report.status) || !Number.isInteger(report.peak) || report.peak<0 || report.peak>32768 || !Number.isFinite(report.rms) || report.rms<0 || report.rms>32768) return json(res,409,{error:'無效音訊回報。'});
        const amp=report.amp && ['volume','system','i2s','boost','magnification','channel'].every(key=>Number.isInteger(report.amp[key]) && report.amp[key]>=-1 && report.amp[key]<=65535) ? Object.fromEntries(['volume','system','i2s','boost','magnification','channel'].map(key=>[key,report.amp[key]])) : null;
        audio={...audio,status:report.status,peak:report.peak,rms:report.rms,amp};
        if(audio.mode==='speech' && speech.job.id===audio.id) {
          if(report.status==='recording' && speech.job.status==='queued') speech.job.status='recording';
          if(report.status.endsWith('_failed') || report.status==='timeout') {speech.job.status='failed';speech.job.error='裝置收音失敗，請重試。';}
        }
        return json(res,200,{accepted:true});
      }
      if(req.method==='GET' && route==='/api/device/playback') {
        const id=new URL(req.url,`http://${host}`).searchParams.get('id');
        try{
          const pcm=synthesis.take(id);
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':pcm.length,'Cache-Control':'no-store','X-Audio-Sample-Rate':'17000'});
          return res.end(pcm);
        }catch{return json(res,409,{error:'播放指令已過期或重複。'});}
      }
      if(req.method==='POST' && route==='/api/device/speech') {
        const id=req.headers['x-stackchan-audio-id'];
        if(speechUploading || !speech.configured || id!==speech.job.id || !['queued','recording'].includes(speech.snapshot().status)) return json(res,409,{error:'錄音指令無效、忙碌或已過期。'});
        if(req.headers['content-type']!=='application/octet-stream') return json(res,415,{error:'需要 PCM。'});
        speechUploading=true;
        try {
          const chunks=[];let length=0;
          for await(const chunk of req){length+=chunk.length;if(length>170000)throw new Error('錄音過長。');chunks.push(chunk);}
          if(length!==170000) throw new Error('需要完整五秒錄音。');
          const pcm=Buffer.concat(chunks);
          void speech.accept(id,pcm).catch(()=>{speech.job.status='failed';speech.job.error='錄音處理失敗。';});
          return json(res,202,{accepted:true});
        } finally {speechUploading=false;}
      }
      if (req.method === 'POST' && route === '/api/device/camera') {
        if (transport !== 'wifi' || !camera.enabled) return json(res,409,{error:'相機未啟動。'});
        if (cameraUploadBusy) return json(res,429,{error:'影像分析忙碌中。'});
        if (req.headers['content-type'] !== 'image/jpeg') return json(res,415,{error:'需要 JPEG。'});
        cameraUploadBusy = true;
        const epoch = cameraEpoch;
        try {
          const chunks=[]; let length=0;
          for await (const chunk of req) { length+=chunk.length; if(length>130000) throw new Error('影像太大。'); chunks.push(chunk); }
          const jpeg=Buffer.concat(chunks);
          if(length<100 || jpeg[0]!==255 || jpeg[1]!==216 || jpeg.at(-2)!==255 || jpeg.at(-1)!==217) return json(res,400,{error:'無效 JPEG。'});
          const calibrate=camera.calibrate; camera.calibrate=false;
          const analysis=await vision.analyze(jpeg,calibrate);
          if(epoch!==cameraEpoch || !camera.enabled) return json(res,409,{error:'相機狀態已變更。'});
          camera.accept({type:'camera_frame',jpeg:jpeg.toString('base64'),...(analysis || {candidate:'unknown',reason:'本機影像分析不可用'})});
          return json(res,200,{accepted:true});
        } finally { cameraUploadBusy=false; }
      }
      if (req.method === 'POST' && route === '/api/device/ack') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res,415,{error:'需要 JSON 資料。'});
        const report=await body(req);const accepted = remoteDevice.acknowledge(report);
        if(accepted)timerEffects.acknowledge(report.effect_id);
        return json(res,accepted ? 200 : 409,{accepted});
      }
      return json(res,404,{error:'找不到裝置操作。'});
    }
    if (publicOrigin) {
      const expected = `Basic ${Buffer.from(`${webUser}:${webPassword}`).toString('base64')}`;
      if (!sameSecret(req.headers.authorization,expected)) {
        res.setHeader('WWW-Authenticate','Basic realm="StackChan", charset="UTF-8"');
        return json(res,401,{error:'請登入管理網頁。'});
      }
    }
    if (req.method === 'GET' && route === '/api/state') return json(res, 200, snapshot());
    if (req.method === 'GET' && route === '/api/messages') return json(res, 200, history());
    if(req.method==='GET' && route==='/api/speech/health') {
      try{return json(res,200,await speech.health());}catch{return json(res,200,{connected:false,error:'語音服務未就緒，請確認 Server 上的服務、網址及金鑰。'});}
    }
    if (req.method === 'GET' && route === '/api/camera/frame') {
      if (!camera.snapshot().fresh || !camera.jpeg) return json(res,404,{error:'沒有最新影像。'});
      res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store, max-age=0','Content-Length':camera.jpeg.length});
      return res.end(camera.jpeg);
    }
    if (req.method === 'GET' && route === '/api/health') {
      const config = { ...settings };
      try {
        const [version, tags] = await Promise.all([ollama(config.ollamaUrl, '/api/version'), ollama(config.ollamaUrl, '/api/tags')]);
        const models = tags.models?.map(m => m.name) || [];
        return json(res, 200, { connected: true, version: version.version, models, modelAvailable: models.includes(config.model) });
      } catch (error) { return json(res, 200, { connected: false, error: error.message }); }
    }
    if (req.method === 'POST' && route.startsWith('/api/')) {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: '需要 JSON 資料。' });
      const input = await body(req);
      userActivityId=randomBytes(4).toString('hex');
      if(route==='/api/activity')return json(res,200,{accepted:true});
      if(route==='/api/motor'){
        if(input.action==='setTimerDegrees'){
          if(!Number.isInteger(input.degrees)||input.degrees<5||input.degrees>30)throw new Error('番茄鐘轉頭幅度請設為 5～30 度。');
          settings.timerMotionDegrees=input.degrees;saveValue('settings',settings);
          return json(res,200,snapshot());
        }
        if(input.action==='saveCenter'){
          if(motor.busy)throw new Error('請先等待居中微調結束。');
          settings.motorCenterOffset=motor.previewCenter??settings.motorCenterOffset;saveValue('settings',settings);
          return json(res,200,snapshot());
        }
        if(!['test','center','resetCenter'].includes(input.action))throw new Error('不支援的馬達操作。');
        if(transport!=='wifi'||!remoteDevice.snapshot().connected)throw new Error('請先連接 Wi-Fi 裝置。');
        if(audioOccupied()||timerVoiceBusy||camera.enabled)throw new Error('請先等待語音結束並停止相機。');
        if(input.action==='test')motor.start(input.degrees);
        else if(input.action==='resetCenter')motor.center(0);
        else {
          if(![-1,1].includes(input.delta))throw new Error('每次微調為 −1° 或 ＋1°。');
          motor.center((motor.previewCenter??settings.motorCenterOffset)+input.delta);
        }
        timerEffects.pending=null;
        return json(res,202,snapshot());
      }
      if(motor.busy&&(['/api/speech','/api/audio','/api/synthesis','/api/timer','/api/chat'].includes(route)||(route==='/api/camera'&&input.action==='start')))throw new Error('請等馬達動作結束。');
      if(route==='/api/synthesis') {
        if((input.volume!==undefined&&(!Number.isInteger(input.volume)||input.volume<32||input.volume>255))||(input.outputGain!==undefined&&![4,8].includes(input.outputGain)))throw new Error('播放音量設定不正確。');
        if(input.action!=='play'||transport!=='wifi'||!remoteDevice.snapshot().connected)throw new Error('請先連接 Wi-Fi 裝置。');
        synthesis.snapshot();if(synthesis.busy)throw new Error('上一段語音仍在處理。');
        if(['queued','recording','transcribing'].includes(speech.snapshot().status)||(audio.requestedAt && Date.now()-audio.requestedAt<20000 && !['completed','timeout'].includes(audio.status) && !audio.status.endsWith('_failed')))throw new Error('請等待目前錄音或播放結束。');
        if(typeof input.text!=='string'||!input.text.trim()||input.text.length>200)throw new Error('朗讀文字需介於 1～200 字。');
        const volume=settings.audioVolume, outputGain=settings.audioOutputGain;
        if(!Number.isInteger(volume)||volume<32||volume>255||![4,8].includes(outputGain))throw new Error('播放音量設定不正確。');
        if(!startCharacterSpeech(input.text,'neutral',input.source==='chat'?'chat':'manual',volume,outputGain))throw new Error('請等待目前語音互動完成。');
        return json(res,202,snapshot());
      }
      if(['/api/speech','/api/audio'].includes(route) || (route==='/api/camera' && input.action==='start')) {
        if(route==='/api/audio'&&((input.volume!==undefined&&(!Number.isInteger(input.volume)||input.volume<32||input.volume>255))||(input.outputGain!==undefined&&![4,8].includes(input.outputGain))))throw new Error('播放音量設定不正確。');
        synthesis.snapshot();if(synthesis.busy)throw new Error('請等待合成語音播放完成。');
      }
      if(route==='/api/speech') {
        if(input.action!=='start' || transport!=='wifi' || !remoteDevice.snapshot().connected) throw new Error('請先連接 Wi-Fi 裝置。');
        if(remoteDevice.snapshot().applied?.audioReady===false)throw new Error('裝置音訊正在恢復，請稍候。');
        if(audio.requestedAt && Date.now()-audio.requestedAt<15000) throw new Error('請等目前音訊測試完成。');
        await speech.health();
        synthesis.snapshot();if(synthesis.busy || ['queued','recording','transcribing'].includes(speech.snapshot().status))throw new Error('另一段語音已開始，請等候完成。');
        const id=randomBytes(4).toString('hex');speech.start(id);
        cameraEpoch++;camera.enable(false);vision.close();
        audio={id,status:'queued',peak:0,rms:0,requestedAt:Date.now(),volume:settings.audioVolume,mode:'speech',outputGain:settings.audioOutputGain};
        return json(res,200,snapshot());
      }
      if(route==='/api/audio') {
        if(['queued','recording','transcribing'].includes(speech.snapshot().status)) throw new Error('語音辨識正在處理中。');
        const volume=settings.audioVolume;
        const outputGain=settings.audioOutputGain;
        if(![4,8].includes(outputGain)) throw new Error('輸出模式不正確。');
        if(!Number.isInteger(volume) || volume<32 || volume>255) throw new Error('音量需介於 32 到 255。');
        if(!['test','speaker'].includes(input.action) || transport!=='wifi' || !remoteDevice.snapshot().connected) throw new Error('請先連接 Wi-Fi 裝置。');
        if(remoteDevice.snapshot().applied?.audioReady===false)throw new Error('裝置音訊正在恢復，請稍候。');
        if(audio.requestedAt && Date.now()-audio.requestedAt<15000) throw new Error('音訊測試正在執行，請稍候。');
        cameraEpoch++; camera.enable(false); vision.close();
        audio={id:randomBytes(4).toString('hex'),status:'queued',peak:0,rms:0,requestedAt:Date.now(),volume,mode:input.action,outputGain};
        return json(res,200,snapshot());
      }
      if (route === '/api/timer') {
        performTimerAction(input.action);
        return json(res,200,snapshot());
      }
      if (route === '/api/presence') { setPresence(state, settings, input.presence); settings.presenceSource = 'manual'; saveValue('settings',settings); saveState(); return json(res, 200, snapshot()); }
      if (route === '/api/camera') {
        if (input.action === 'start') { cameraEpoch++; vision.close(); camera.enable(true); }
        else if (input.action === 'stop') { cameraEpoch++; camera.enable(false); vision.close(); }
        else if (input.action === 'calibrate') { if (!camera.snapshot().fresh) throw new Error('請先取得清楚的最新畫面。'); camera.calibrate = true; }
        else if (input.action === 'source' && ['manual','camera'].includes(input.source)) { settings.presenceSource = input.source; saveValue('settings',settings); }
        else throw new Error('相機操作不正確。');
        return json(res,200,snapshot());
      }
      if (route === '/api/audio/settings') {
        if(!Number.isInteger(input.volume)||input.volume<32||input.volume>255||![4,8].includes(input.outputGain))throw new Error('播放音量設定不正確。');
        const gainChanged=settings.audioOutputGain!==input.outputGain;
        settings.audioVolume=input.volume;settings.audioOutputGain=input.outputGain;
        saveValue('settings',settings);
        if(gainChanged){voiceRevision++;preparedVoices.clear();completionVoiceKey='';timerVoiceRequest++;timerVoiceBusy=false;}
        return json(res,200,snapshot());
      }
      if (route === '/api/settings') {
        const nextSettings = validateSettings(input);
        nextSettings.audioVolume=settings.audioVolume;nextSettings.audioOutputGain=settings.audioOutputGain;
        nextSettings.motorCenterOffset=settings.motorCenterOffset;
        nextSettings.timerMotionDegrees=settings.timerMotionDegrees;
        if (reconcile(state, settings)) saveState();
        settings = nextSettings; saveValue('settings', settings);
        voiceRevision++;preparedVoices.clear();completionVoiceKey='';timerVoiceRequest++;timerVoiceBusy=false;
        if(!settings.timerVoice){timerVoiceRequest++;timerVoiceBusy=false;}
        if (state.timer.status === 'idle') state.timer.remainingMs = settings[state.timer.phase === 'focus' ? 'focusMinutes' : 'breakMinutes'] * 60000;
        reconcile(state, settings); saveState(); return json(res, 200, snapshot());
      }
      if (route === '/api/chat') {
        if (chatBusy) return json(res, 409, { error: '正在回覆上一則訊息，請稍候。' });
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1000) throw new Error('請輸入 1～1000 字的訊息。');
        chatBusy = true;
        try {
          const config = { ...settings };
          const current = snapshot();
          const recent = history().slice(-12).map(m => ({ role: m.role, content: m.role === 'assistant' ? JSON.stringify({ text: m.content, expression: m.expression }) : m.content }));
          const result = await ollama(config.ollamaUrl, '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            model: config.model, stream: false, think: false, keep_alive: '30m', format: schema,
            options: { num_ctx: 4096, num_predict: 300, temperature: 0.7 },
            messages: [{ role: 'system', content: systemPrompt + '\n目前系統狀態：' + JSON.stringify({ presence: current.presence, timer: current.timer, todayCompleted: current.todayCompleted }) }, ...recent, { role: 'user', content: input.text.trim() }]
          }) }, 150000);
          let answer;
          try { answer = JSON.parse(result.message?.content); } catch { throw new Error('模型回覆格式不正確，請重試。'); }
          if (result.done_reason === 'length' || typeof answer.text !== 'string' || !answer.text.trim() || answer.text.length > 500 || !['neutral', 'happy', 'teasing', 'concerned'].includes(answer.expression)) throw new Error('模型回覆不完整或格式不正確，請重試。');
          db.exec('BEGIN');
          try {
            const insert = db.prepare('INSERT INTO messages(role, content, expression, created_at) VALUES (?, ?, ?, ?)');
            insert.run('user', input.text.trim(), null, Date.now());
            insert.run('assistant', answer.text.trim(), answer.expression, Date.now());
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          setCharacter(answer.expression,answer.text.trim(),'chat');
          if(settings.autoSpeakReplies)startCharacterSpeech(answer.text.trim(),answer.expression,'chat');
          return json(res, 200, { text: answer.text.trim(), expression: answer.expression, durationMs: Math.round(result.total_duration / 1e6) });
        } catch (error) { return json(res, 502, { error: error.message }); }
        finally { chatBusy = false; }
      }
      return json(res, 404, { error: '找不到這個操作。' });
    }
    const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (req.method === 'GET' && files[route]) {
      const [file, type] = files[route];
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      return res.end(readFileSync(path.join(root, 'public', file)));
    }
    json(res, 404, { error: '找不到頁面。' });
  } catch (error) { json(res, 400, { error: error.message }); }
});
function performTimerAction(action){
  if(motor.busy)throw new Error('請等馬達動作結束。');
  timerAction(state,settings,action);
  if(action==='nextStart')action='start';
  userActivityId=randomBytes(4).toString('hex');
  if(invalidatesTimerVoice(action)){voiceRevision++;preparedVoices.clear();completionVoiceKey='';timerVoiceRequest++;timerVoiceBusy=false;}
  if(['start','resume'].includes(action))completionVoiceKey=voiceKey('completed',state.timer.phase);
  saveState();applyTimerCharacter(action,state.timer.phase);timerEffects.action(action);scheduleTimerVoicePreparation();
}
const port = Number(process.env.PORT || 3000);
realtime=attachRealtime(server,{
  authorize:req=>{
    const host=req.headers.host,route=new URL(req.url,`http://${host}`).pathname;
    const local=[`127.0.0.1:${port}`,`localhost:${port}`],external=[publicOrigin,devOrigin].filter(Boolean).map(origin=>new URL(origin).host);
    if(![...local,...external].includes(host))return null;
    if(publicOrigin.startsWith('https:')&&host===new URL(publicOrigin).host&&req.headers['x-forwarded-proto']!=='https')return null;
    if(req.headers.origin&&![...local.map(host=>`http://${host}`),publicOrigin].includes(req.headers.origin))return null;
    if(route==='/api/device/live')return remoteDevice.authorized(req.headers.authorization)?'device':null;
    if(route!=='/api/live'||host===(devOrigin?new URL(devOrigin).host:null))return null;
    if(publicOrigin&&!sameSecret(req.headers.authorization,`Basic ${Buffer.from(`${webUser}:${webPassword}`).toString('base64')}`))return null;
    if(!req.headers.origin)return null;
    return 'browser';
  },getState:snapshot,
  getFrame:()=>{
    const job=motor.snapshot(),s=snapshot();
    const frame=remoteDevice.issue(s,currentExpression(),deviceEffects()).trim();
    const center=job.status==='queued'&&job.mode==='center'?job.centerOffset:motor.previewCenter??settings.motorCenterOffset;
    const playback=synthesis.snapshot();
    return `${frame}\nB|${center}|${settings.timerMotionDegrees}|${job.status==='queued'?job.id:'00000000'}|${job.mode==='center'?'c':'s'}|${job.degrees}|${playback.status==='queued'?playback.id:'00000000'}|${userActivityId}`;
  },onDeviceMessage:report=>{
    if(report.type==='timer_control'){
      snapshot();
      const result=deviceTimerControl.apply(report,{session:remoteDevice.session,timer:state.timer,run:performTimerAction});
      realtime.push();return result;
    }
    if(report.type==='sync_ack'){if(remoteDevice.acknowledge(report))timerEffects.acknowledge(report.effect_id);}
    else if(report.type==='motor_result')motor.report(report);
  }
});
server.listen(port, devOrigin || publicOrigin.startsWith('http:') ? '0.0.0.0' : '127.0.0.1', () => console.log(`StackChan ready: http://127.0.0.1:${port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; clearInterval(ticker); device.close(); db.close(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(ticker); device.close(); vision.close(); saveState(); server.close(() => { db.close(); process.exit(0); }); });
