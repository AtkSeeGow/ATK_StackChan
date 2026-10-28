const $ = id => document.getElementById(id);
let state, receivedAt, pendingChat = false, settingsLoaded = false, pendingAction = false, cameraSeq = -1, insertedSpeechId = '';
let mutationEpoch=0, motorSaveNotice='';
let liveSocket, lastLiveAt=0;
const names = { neutral: '平靜陪伴', happy: '開心', teasing: '有點得意', concerned: '有點擔心' };
async function api(route, data) {
  const response = await fetch('/api/' + route, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),...(route==='motor'?{signal:AbortSignal.timeout(10000)}:{}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失敗，請重試。');
  return result;
}
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
function render() {
  if (!state) return;
  const t = state.timer;
  const elapsed = t.status === 'running' ? Date.now() - receivedAt : 0;
  const seconds = Math.max(0, Math.ceil((t.remainingMs - elapsed) / 1000));
  $('countdown').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('phaseLabel').textContent = t.phase === 'focus' ? '專注時間' : '休息時間';
  $('timerStatus').textContent = { idle: '準備開始', running: '照自己的步調來', paused: t.pauseReason === 'absence' ? '因離席暫停 · 回來後手動繼續' : '已暫停', completed: '這一段完成了！' }[t.status];
  if(state.settings.timerVoice&&state.timerVoicePreparation){
    const labels={ready:'已備妥',preparing:'準備中',failed:'稍後重試',waiting:'待準備'};
    $('timerHint').textContent=`語音預備：開始${labels[state.timerVoicePreparation.start]}／暫停${labels[state.timerVoicePreparation.pause]}／繼續${labels[state.timerVoicePreparation.resume]}／結束${labels[state.timerVoicePreparation.end]}。台詞與音訊提前準備，事件到時播放。`;
  }
  $('primaryTimer').textContent = { idle: t.phase === 'focus' ? '開始專注' : '開始休息', running: '暫停', paused: '繼續計時', completed: t.phase === 'focus' ? '準備休息' : '準備專注' }[t.status];
  $('switchTimerPhase').textContent=t.phase==='focus'?'改為休息':'改為專注';
  $('rounds').textContent = `今日 ${state.todayCompleted} 輪`;
  document.querySelectorAll('[data-presence]').forEach(b => { b.classList.toggle('active', b.dataset.presence === state.presence); b.setAttribute('aria-pressed', b.dataset.presence === state.presence); });
  $('modelLabel').textContent = state.settings.model;
  $('presenceSourceLabel').textContent = state.settings.presenceSource === 'camera' ? '相機來源' : '手動來源';
  const deviceText = state.device?.connected ? `● StackChan 已連線 · ${state.realtime?.device?'WebSocket 即時同步':state.device.port} · 番茄鐘與表情同步中` : `○ StackChan 未連線 · ${state.device?.detail || '等待裝置回應'}（網頁仍可使用）`;
  if ($('deviceStatus').textContent !== deviceText) $('deviceStatus').textContent = deviceText;
  if(state.device?.applied?.screenSleeping)$('deviceStatus').textContent+=' · 螢幕休眠，觸碰可喚醒';
  $('primaryTimer').disabled = pendingAction;
  $('switchTimerPhase').disabled=pendingAction||t.status!=='idle';
  $('resetTimer').disabled = pendingAction;
  const cam = state.camera;
  const audio = state.audio;
  if(state.character?.text) expression(state.character.expression,state.character.text);
  if(state.interaction){
    $('interactionStatus').textContent=state.interaction.label;
    $('interactionStatus').dataset.mode=state.interaction.mode;
  }
  const synthesisBusy=['synthesizing','queued','downloading','playback'].includes(state.synthesis?.status);
  const motorBusy=['queued','running'].includes(state.motor?.status)||state.device?.applied?.motionBusy===true;
  if(state.motor){
    const labels={idle:'準備調整',queued:state.motor.mode==='center'?'正在送出居中微調，請等待裝置回報':'已送出，裝置將低速左右往返；請等待回報',running:'正在執行動作',completed:state.motor.mode==='center'?'微調命令已送出並等待到位，現已斷電；尚無位置回讀，請以實際朝向確認':'往返命令已送出，馬達已斷電；請確認實際回正及有無異音',failed:state.motor.error,timeout:state.motor.error};
    $('motorStatus').textContent=labels[state.motor.status]||'等待裝置';
    $('motorBadge').textContent=motorBusy?'執行中':state.motor.status==='completed'?'命令已送':'待機';
    $('motorTest').disabled=pendingAction||motorBusy||!state.device?.connected||state.device?.transport!=='wifi'||synthesisBusy||cam?.enabled||!state.interaction?.canSpeak;
    $('motorDegrees').disabled=motorBusy;
    $('motorApplyTimer').disabled=pendingAction||motorBusy;
    $('timerMotionLabel').textContent=`番茄鐘動作：±${state.settings.timerMotionDegrees}°。選擇幅度後按「套用至番茄鐘」保存；套用不會立即移動。俯仰軸停用。`;
    const unavailable=$('motorTest').disabled;
    $('motorCenterValue').textContent=`目前居中偏移：${state.motor.centerOffset}° · 已保存：${state.motor.savedCenterOffset}°`;
    $('motorCenterMinus').disabled=unavailable||state.motor.centerOffset<=-15;
    $('motorCenterPlus').disabled=unavailable||state.motor.centerOffset>=15;
    $('motorCenterReset').disabled=unavailable;
    $('motorCenterSave').disabled=motorBusy||pendingAction;
    $('motorCenterSave').textContent=motorSaveNotice==='saving'?'保存中…':'保存為居中';
    $('motorSaveStatus').textContent=motorSaveNotice==='saving'?'正在保存設定…':motorSaveNotice;
    document.querySelectorAll('[data-motor-degrees]').forEach(button=>button.disabled=motorBusy);
  }
  if(state.synthesis){
    const labels={idle:'尚未播放',synthesizing:'正在合成語音',queued:'等待裝置下載',downloading:'裝置正在下載音訊',playback:'裝置播放中',completed:'播放流程完成，請確認聽感',failed:state.synthesis.error,timeout:'播放逾時，請確認裝置韌體與連線'};
    $('synthesisStatus').textContent=labels[state.synthesis.status] || '等待播放';
    $('synthesisPlay').disabled=pendingAction||!state.interaction?.canSpeak||!state.synthesis.configured;
    $('synthesisUseReply').disabled=pendingAction||!state.interaction?.canSpeak||!state.synthesis.configured;
  }
  if(state.speech) {
    const s=state.speech;
    $('speechStart').disabled=pendingAction || !state.interaction?.canListen || !s.configured;
    $('speechStatus').textContent=({idle:s.configured ? '準備收音五秒' : '等待 Server 語音服務設定',queued:'等待裝置收音',recording:'收音中，請說話（五秒）',transcribing:'正在 Server 轉成文字',completed:'辨識完成，請確認文字',empty:'未辨識到明確人聲，請重試',failed:s.error,timeout:'裝置錄音未送達，請重試'})[s.status] || s.status;
    $('speechText').textContent=s.text || '';
    $('speechUse').disabled=!s.text;
    if(s.status==='completed'&&s.text&&s.id!==insertedSpeechId&&!$('chatInput').value.trim()){
      $('chatInput').value=s.text;insertedSpeechId=s.id;
      $('chatHint').textContent='語音已帶入，請確認文字後再傳送';
    }
  }
  if(audio) {
    const label={idle:'尚未測試',queued:'等待裝置開始',tone:'播放短提示音，準備說話',recording:'正在收音兩秒，請說話',playback:'正在裝置回放',completed:'錄音與回放流程完成，請確認聽感',timeout:'測試逾時，請確認裝置連線'}[audio.status] || '音訊測試失敗，請重試';
    $('audioStatus').textContent=`${audio.mode==='speaker' ? '喇叭測試（不收音） · ' : ''}${audio.mode==='speaker' && audio.status==='completed' ? '固定測試音播放流程完成，請確認音量' : label} · 峰值 ${audio.peak} · RMS ${audio.rms}`;
    $('audioTest').disabled=pendingAction || synthesisBusy || (audio.requestedAt && state.now-audio.requestedAt<15000) || state.device?.transport!=='wifi' || !state.device?.connected;
    $('speakerTest').disabled=$('audioTest').disabled;
  }
  if (cam) {
    const labels = {present:'在席',absent:'離席',unknown:'未知'};
    $('cameraStatus').textContent = cam.fresh ? `辨識：${labels[cam.presence]}` : cam.enabled ? '等待影像' : '已停止';
    $('cameraReason').textContent = cam.reason;
    $('cameraEvidence').textContent = `臉部：${cam.faces} · 空位校準：${cam.baseline ? '已建立（僅記憶體）' : '尚未建立'} · 目前來源：${state.settings.presenceSource === 'camera' ? '相機' : '手動'}`;
    $('cameraAuto').checked = state.settings.presenceSource === 'camera';
    $('cameraStart').disabled = cam.enabled || pendingAction || synthesisBusy;
    $('cameraStop').disabled = !cam.enabled || pendingAction;
    $('cameraCalibrate').disabled = !cam.fresh || pendingAction;
    $('cameraPreview').hidden = !cam.fresh;
    $('cameraEmpty').hidden = cam.fresh;
    if (cam.fresh && cam.seq !== cameraSeq) { cameraSeq = cam.seq; $('cameraPreview').src = `/api/camera/frame?seq=${cam.seq}`; }
    if (!cam.enabled) { $('cameraPreview').removeAttribute('src'); cameraSeq = -1; }
  }
}
function fillSettings() {
  for (const [key, value] of Object.entries(state.settings)) {
    const field = $('settingsForm').elements.namedItem(key);
    if (field) field.type==='checkbox' ? field.checked=Boolean(value) : field.value=value;
  }
  $('audioVolume').value=state.settings.audioVolume; $('audioOutputGain').value=state.settings.audioOutputGain;
  $('audioVolumeValue').textContent=`${state.settings.audioVolume} / 255`;
  toggleGrace(); settingsLoaded = true;
}
function toggleGrace() { $('graceField').hidden = $('settingsForm').elements.absencePolicy.value !== 'grace'; }
async function refresh() {
  if(liveSocket?.readyState===WebSocket.OPEN&&Date.now()-lastLiveAt<4000)return;
  const epoch=mutationEpoch;
  try { const next=await api('state');if(pendingAction||epoch!==mutationEpoch)return;state=next; receivedAt = Date.now(); if ($('notice').textContent === '本機服務未連線，顯示的計時可能已過期。請確認服務仍在執行。') notice(); if (!settingsLoaded) fillSettings(); render(); }
  catch { notice('本機服務未連線，顯示的計時可能已過期。請確認服務仍在執行。'); }
}
async function action(route, data) {
  if (pendingAction) return;
  const saving=route==='motor'&&data.action==='saveCenter';
  if(saving)motorSaveNotice='saving';
  else if(route==='motor')motorSaveNotice='';
  mutationEpoch++;pendingAction = true; render();
  try { state = await api(route, data); receivedAt = Date.now(); notice();if(saving)motorSaveNotice=`已保存：${state.motor.savedCenterOffset}°（保存不會移動馬達）`;else if(route==='motor'&&data.action==='setTimerDegrees')motorSaveNotice=`番茄鐘轉頭幅度已保存為 ±${state.settings.timerMotionDegrees}°`; }
  catch (error) { const message=error.name==='TimeoutError'?'請求逾時，請重新整理確認結果；勿連按重送動作。':error.message;notice(message);if(saving)motorSaveNotice=`保存未確認：${message}`; }
  finally { mutationEpoch++;pendingAction = false; render(); }
}
function motorSelection(degrees){$('motorDegrees').value=degrees;$('motorDegreesValue').textContent=`±${degrees}°`;}
$('motorDegrees').oninput=event=>motorSelection(Number(event.target.value));
document.querySelectorAll('[data-motor-degrees]').forEach(button=>button.onclick=()=>motorSelection(Number(button.dataset.motorDegrees)));
$('motorTest').onclick=()=>action('motor',{action:'test',degrees:Number($('motorDegrees').value)});
$('motorApplyTimer').onclick=()=>action('motor',{action:'setTimerDegrees',degrees:Number($('motorDegrees').value)});
$('motorCenterMinus').onclick=()=>action('motor',{action:'center',delta:-1});
$('motorCenterPlus').onclick=()=>action('motor',{action:'center',delta:1});
$('motorCenterSave').onclick=()=>action('motor',{action:'saveCenter'});
$('motorCenterReset').onclick=()=>action('motor',{action:'resetCenter'});
$('primaryTimer').onclick = () => { if (state) action('timer', { action: { idle: 'start', running: 'pause', paused: 'resume', completed: 'next' }[state.timer.status] }); };
$('switchTimerPhase').onclick=()=>action('timer',{action:'switch'});
$('resetTimer').onclick = () => action('timer', { action: 'reset' });
document.querySelectorAll('[data-presence]').forEach(b => b.onclick = () => action('presence', { presence: b.dataset.presence }));
$('settingsForm').elements.absencePolicy.onchange = toggleGrace;
$('settingsForm').onsubmit = async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  for (const key of ['focusMinutes', 'breakMinutes', 'absenceGraceSeconds']) values[key] = Number(values[key]);
  for (const key of ['timerVoice','autoSpeakReplies','timerLights','timerMotion']) values[key] = event.currentTarget.elements[key].checked;
  values.presenceSource = state.settings.presenceSource || 'manual';
  $('saveSettings').disabled = true; $('settingsSaved').textContent = '';
  try { state = await api('settings', values); receivedAt = Date.now(); render(); notice(); $('settingsSaved').textContent = '已儲存'; await checkHealth(); }
  catch (error) { notice(error.message); }
  finally { $('saveSettings').disabled = false; }
};
async function checkHealth() {
  $('checkConnection').disabled = true; $('healthText').textContent = '檢查連線中…';
  try {
    const result = await api('health');
    $('healthDot').className = 'dot ' + (result.connected && result.modelAvailable ? 'online' : 'offline');
    $('healthText').textContent = result.connected ? (result.modelAvailable ? 'Ollama 已連線' : '已連線 · 模型未安裝') : 'Ollama 未連線';
    $('healthText').title = result.error || `版本 ${result.version}；模型：${result.models?.join('、')}`;
  } catch { $('healthDot').className = 'dot offline'; $('healthText').textContent = '本機服務未連線'; }
  finally { $('checkConnection').disabled = false; }
}
$('checkConnection').onclick = checkHealth;
$('cameraStart').onclick = () => action('camera',{action:'start'});
$('audioTest').onclick = () => action('audio',{action:'test',volume:Number($('audioVolume').value),outputGain:Number($('audioOutputGain').value)});
$('speakerTest').onclick = () => action('audio',{action:'speaker',volume:Number($('audioVolume').value),outputGain:Number($('audioOutputGain').value)});
const saveGlobalAudio=()=>action('audio/settings',{volume:Number($('audioVolume').value),outputGain:Number($('audioOutputGain').value)});
$('audioVolume').onchange=saveGlobalAudio;
$('audioOutputGain').onchange=saveGlobalAudio;
$('audioVolume').oninput = event => { $('audioVolumeValue').textContent=`${event.target.value} / 255`; };
$('speechStart').onclick=()=>action('speech',{action:'start'});
$('synthesisPlay').onclick=()=>action('synthesis',{action:'play',text:$('synthesisText').value,volume:Number($('audioVolume').value),outputGain:Number($('audioOutputGain').value)});
$('synthesisUseReply').onclick=async()=>{if(pendingAction)return;pendingAction=true;render();try{const messages=await api('messages');const latest=messages.findLast(m=>m.role==='assistant');if(!latest)throw new Error('尚無 AI 回覆可朗讀。');if(latest.content.length>200)throw new Error('回覆超過 200 字，請改用下方手動朗讀。');state=await api('synthesis',{action:'play',source:'chat',text:latest.content,volume:Number($('audioVolume').value),outputGain:Number($('audioOutputGain').value)});receivedAt=Date.now();notice();}catch(error){notice(error.message||'無法播放最新回覆。');}finally{pendingAction=false;render();}};
$('speechUse').onclick=()=>{if(state?.speech?.text){$('chatInput').value=state.speech.text;$('chatInput').focus();}};
$('speechCheck').onclick=async()=>{try{const h=await api('speech/health');$('speechHealth').textContent=h.connected ? `語音服務已連線 · ${h.device} · ${h.model}` : h.error;}catch{$('speechHealth').textContent='語音服務無法連線';}};
$('cameraStop').onclick = () => action('camera',{action:'stop'});
$('cameraCalibrate').onclick = () => action('camera',{action:'calibrate'});
$('cameraAuto').onchange = event => action('camera',{action:'source',source:event.currentTarget.checked ? 'camera' : 'manual'});
function expression(value, text) {
  $('avatar').dataset.expression = value;
  $('avatar').setAttribute('aria-label', '角色表情：' + names[value]);
  $('expressionLabel').textContent = names[value];
  $('characterLine').textContent = text;
}
function showMessages(messages) {
  const container = $('messages');
  if (!messages.length) return;
  container.replaceChildren();
  for (const message of messages) {
    const item = document.createElement('div'); item.className = 'message ' + message.role;
    const label = document.createElement('span'); label.className = 'speaker'; label.textContent = message.role === 'user' ? '你' : 'STACKCHAN';
    const content = document.createElement('span'); content.textContent = message.content;
    item.append(label, content); container.append(item);
  }
  container.scrollTop = container.scrollHeight;
  const last = messages.findLast(m => m.role === 'assistant');
  if (last) expression(last.expression, last.content);
}
async function loadMessages() { showMessages(await api('messages')); }
$('chatForm').onsubmit = async event => {
  event.preventDefault(); if (pendingChat) return;
  const text = $('chatInput').value.trim(); if (!text) return;
  pendingChat = true; $('sendChat').disabled = true; $('chatInput').disabled = true;
  $('chatHint').textContent = '正在想怎麼回你…首次載入可能需要約 1～2 分鐘';
  notice();
  try {
    const result = await api('chat', { text });
    $('chatInput').value = ''; await loadMessages(); expression(result.expression, result.text);
    $('chatHint').textContent = `回覆完成 · ${(result.durationMs / 1000).toFixed(1)} 秒`;
  } catch (error) { notice(error.message); $('chatHint').textContent = '訊息保留在輸入框，可重新傳送。'; }
  finally { pendingChat = false; $('sendChat').disabled = false; $('chatInput').disabled = false; $('chatInput').focus(); }
};
$('chatInput').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chatForm').requestSubmit(); } };
function connectLive(){
  liveSocket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/live`);
  liveSocket.onmessage=event=>{
    lastLiveAt=Date.now();if(pendingAction)return;
    try{const next=JSON.parse(event.data);if(!next.timer||!next.settings)return;state=next;receivedAt=Date.now();if(!settingsLoaded)fillSettings();render();}catch{}
  };
  liveSocket.onclose=()=>{lastLiveAt=0;setTimeout(connectLive,2000);};
  liveSocket.onerror=()=>liveSocket.close();
}
let lastActivitySent=0;
function reportActivity(){
  if(Date.now()-lastActivitySent<15000)return;
  lastActivitySent=Date.now();void api('activity',{}).catch(()=>{});
}
document.addEventListener('pointerdown',reportActivity,{passive:true});
document.addEventListener('keydown',reportActivity,{passive:true});
window.addEventListener('focus',reportActivity);
await refresh();
reportActivity();
connectLive();
loadMessages().catch(error => notice(error.message));
checkHealth();
setInterval(refresh, 2000);
setInterval(render, 250);
