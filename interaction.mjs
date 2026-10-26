export const timerCue = (action, phase) => {
  if (action === 'start') return phase === 'focus'
    ? {text:'專注時間開始囉，雜魚，先把手邊這件事做好吧。',expression:'teasing'}
    : {text:'休息時間開始啦，起來伸個懶腰、喝口水吧。',expression:'concerned'};
  if (action === 'resume') return phase === 'focus'
    ? {text:'回來啦？那就繼續這段專注時間，一起把事情做完。',expression:'teasing'}
    : {text:'休息還沒結束，回來就繼續放鬆一下吧。',expression:'concerned'};
  if (action === 'completed') return phase === 'focus'
    ? {text:'這段專注做完囉，辛苦啦！先喘口氣，等等再來。',expression:'happy'}
    : {text:'休息結束囉。準備好了就回來吧。',expression:'neutral'};
  if (action === 'pause') return {text:phase==='focus'?'先暫停這段專注，喝口水，等等再繼續吧。':'休息計時先暫停，準備好了再繼續就好。',expression:'concerned'};
  if (action === 'next') return {text:phase === 'focus' ? '下一段是專注時間。' : '接著休息一下吧。',expression:'neutral'};
  return null;
};

export function timerLineRelevant(text,action,phase){
  if(typeof text!=='string'||!text.trim()||text.length>120)return false;
  if(/摸魚|內卷|加油幹|視頻|質量|小伙伴|充電寶|給力|咱們|啥|專注的繼續|這波專注|再忙起來/.test(text))return false;
  if(['start','pause','resume','completed'].includes(action)){
    if(!text.includes(phase==='focus'?'專注':'休息'))return false;
    if(action==='start'&&!/開始|開工|來囉|來啦/.test(text))return false;
    if(action==='pause'&&!/暫停|先停|停一下|稍停/.test(text))return false;
    if(action==='resume'&&!/回來|繼續|接著|接續|再來|重新/.test(text))return false;
    if(action==='completed'&&!/完成|做完|結束|時間到|告一段落/.test(text))return false;
  }
  return true;
}

export function timerVoiceContext({action,phase,todayCompleted,presence,pauseReason,now=Date.now(),recent=[]}) {
  const localTime=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
  const eventMeaning={
    start:'使用者現在第一次開始這一段計時；台詞要呼應正式開始。',
    resume:'使用者先前暫停了同一段計時，現在回來繼續；台詞必須明確呼應回來、繼續或接著完成，不能寫成第一次開始、起床或無關自言自語。',
    pause:'使用者剛剛手動暫停這一段計時；台詞要呼應暫停、稍停或整理一下。',
    completed:'這一段計時剛完成；台詞要呼應完成，專注階段可參考今日完成輪數。',
    next:'使用者正在切換到下一個專注或休息階段；台詞要呼應階段轉換。'
  }[action]||'台詞必須直接呼應目前計時事件。';
  return JSON.stringify({event:action,eventMeaning,phase,phaseName:phase==='focus'?'專注':'休息',languageStyle:'台灣繁體中文口語，明說本段是專注或休息，開始和結束不要搞反。自然使用「辛苦啦、喝口水、伸個懶腰、先喘口氣」，避免中國用語及生硬翻譯。',todayCompleted,presence,pauseReason:pauseReason||null,localTime,recentLines:recent.slice(-4)});
}

export function interactionState({speech,synthesis,audio,device,camera,characterBusy=false}) {
  const connected = device?.connected === true && device?.transport === 'wifi';
  const deviceAudioReady = device?.applied?.audioReady !== false;
  const synthesisBusy = ['synthesizing','queued','downloading','playback'].includes(synthesis?.status);
  const speechBusy = ['queued','recording','transcribing'].includes(speech?.status);
  const probeBusy = audio?.mode !== 'speech' && audio?.requestedAt && Date.now()-audio.requestedAt < 20000 && !['completed','timeout'].includes(audio.status) && !String(audio.status).endsWith('_failed');
  let mode='ready', label=connected ? '準備聽你說話，也可以讓角色回應' : '等待 StackChan 連線';
  if (synthesisBusy) { mode='speaking'; label={synthesizing:'正在準備角色語音',queued:'語音已就緒，等待裝置',downloading:'裝置正在接收語音',playback:'StackChan 正在說話'}[synthesis.status]; }
  else if (speechBusy) { mode='listening'; label={queued:'等待裝置開始收音',recording:'正在聽你說話',transcribing:'正在把語音轉成文字'}[speech.status]; }
  else if (probeBusy) { mode='testing'; label='正在使用裝置音訊'; }
  else if (speech?.status === 'completed') { mode='review'; label='辨識完成，請確認文字後再傳送'; }
  else if (speech?.status === 'timeout') { mode='needs_attention'; label='裝置沒有送回錄音，請檢查音訊狀態'; }
  else if (connected&&!deviceAudioReady) { mode='recovering'; label='裝置音訊正在恢復'; }
  else if (characterBusy) { mode='thinking'; label='正在依目前情境準備角色台詞'; }
  return {mode,label,canListen:connected && deviceAudioReady && !synthesisBusy && !speechBusy && !probeBusy,canSpeak:connected && deviceAudioReady && !synthesisBusy && !speechBusy && !probeBusy,cameraPaused:camera?.enabled === false,requiresChatConfirmation:true};
}
