const $ = id => document.getElementById(id);
let state, receivedAt, pendingChat = false, settingsLoaded = false, pendingAction = false, cameraSeq = -1;
const names = { neutral: '平靜陪伴', happy: '開心', teasing: '有點得意', concerned: '有點擔心' };
async function api(route, data) {
  const response = await fetch('/api/' + route, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
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
  $('primaryTimer').textContent = { idle: t.phase === 'focus' ? '開始專注' : '開始休息', running: '暫停', paused: '繼續計時', completed: t.phase === 'focus' ? '準備休息' : '準備專注' }[t.status];
  $('rounds').textContent = `今日 ${state.todayCompleted} 輪`;
  document.querySelectorAll('[data-presence]').forEach(b => { b.classList.toggle('active', b.dataset.presence === state.presence); b.setAttribute('aria-pressed', b.dataset.presence === state.presence); });
  $('modelLabel').textContent = state.settings.model;
  $('presenceSourceLabel').textContent = state.settings.presenceSource === 'camera' ? '相機來源' : '手動來源';
  const deviceText = state.device?.connected ? `● StackChan 已連線 · ${state.device.port} · 番茄鐘與表情同步中` : `○ StackChan 未連線 · ${state.device?.detail || '等待裝置回應'}（網頁仍可使用）`;
  if ($('deviceStatus').textContent !== deviceText) $('deviceStatus').textContent = deviceText;
  $('primaryTimer').disabled = pendingAction;
  $('resetTimer').disabled = pendingAction;
  const cam = state.camera;
  const audio = state.audio;
  if(state.speech) {
    const s=state.speech;
    $('speechStart').disabled=pendingAction || !s.configured || !state.device?.connected || state.device?.transport!=='wifi' || ['queued','recording','transcribing'].includes(s.status);
    $('speechStatus').textContent=({idle:s.configured ? '準備收音五秒' : '等待 Server 語音服務設定',queued:'等待裝置收音',recording:'收音中，請說話（五秒）',transcribing:'正在 Server 轉成文字',completed:'辨識完成，請確認文字',empty:'未辨識到明確人聲，請重試',failed:s.error,timeout:'裝置錄音未送達，請重試'})[s.status] || s.status;
    $('speechText').textContent=s.text || '';
    $('speechUse').disabled=!s.text;
  }
  if(audio) {
    const label={idle:'尚未測試',queued:'等待裝置開始',tone:'播放短提示音，準備說話',recording:'正在收音兩秒，請說話',playback:'正在裝置回放',completed:'錄音與回放流程完成，請確認聽感',timeout:'測試逾時，請確認裝置連線'}[audio.status] || '音訊測試失敗，請重試';
    $('audioStatus').textContent=`${audio.mode==='speaker' ? '喇叭測試（不收音） · ' : ''}${audio.mode==='speaker' && audio.status==='completed' ? '固定測試音播放流程完成，請確認音量' : label} · 峰值 ${audio.peak} · RMS ${audio.rms}`;
    $('audioTest').disabled=pendingAction || (audio.requestedAt && state.now-audio.requestedAt<15000) || state.device?.transport!=='wifi' || !state.device?.connected;
    $('speakerTest').disabled=$('audioTest').disabled;
  }
  if (cam) {
    const labels = {present:'在席',absent:'離席',unknown:'未知'};
    $('cameraStatus').textContent = cam.fresh ? `辨識：${labels[cam.presence]}` : cam.enabled ? '等待影像' : '已停止';
    $('cameraReason').textContent = cam.reason;
    $('cameraEvidence').textContent = `臉部：${cam.faces} · 空位校準：${cam.baseline ? '已建立（僅記憶體）' : '尚未建立'} · 目前來源：${state.settings.presenceSource === 'camera' ? '相機' : '手動'}`;
    $('cameraAuto').checked = state.settings.presenceSource === 'camera';
    $('cameraStart').disabled = cam.enabled || pendingAction;
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
    if (field) field.value = value;
  }
  toggleGrace(); settingsLoaded = true;
}
function toggleGrace() { $('graceField').hidden = $('settingsForm').elements.absencePolicy.value !== 'grace'; }
async function refresh() {
  try { state = await api('state'); receivedAt = Date.now(); if ($('notice').textContent === '本機服務未連線，顯示的計時可能已過期。請確認服務仍在執行。') notice(); if (!settingsLoaded) fillSettings(); render(); }
  catch { notice('本機服務未連線，顯示的計時可能已過期。請確認服務仍在執行。'); }
}
async function action(route, data) {
  if (pendingAction) return;
  pendingAction = true; render();
  try { state = await api(route, data); receivedAt = Date.now(); notice(); }
  catch (error) { notice(error.message); }
  finally { pendingAction = false; render(); }
}
$('primaryTimer').onclick = () => { if (state) action('timer', { action: { idle: 'start', running: 'pause', paused: 'resume', completed: 'next' }[state.timer.status] }); };
$('resetTimer').onclick = () => action('timer', { action: 'reset' });
document.querySelectorAll('[data-presence]').forEach(b => b.onclick = () => action('presence', { presence: b.dataset.presence }));
$('settingsForm').elements.absencePolicy.onchange = toggleGrace;
$('settingsForm').onsubmit = async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  for (const key of ['focusMinutes', 'breakMinutes', 'absenceGraceSeconds']) values[key] = Number(values[key]);
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
$('audioVolume').oninput = event => { $('audioVolumeValue').textContent=`${event.target.value} / 255`; };
$('speechStart').onclick=()=>action('speech',{action:'start'});
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
await refresh();
loadMessages().catch(error => notice(error.message));
checkHealth();
setInterval(refresh, 2000);
setInterval(render, 250);
