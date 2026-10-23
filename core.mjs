export const defaults = {
  focusMinutes: 25, breakMinutes: 5, absencePolicy: 'continue', absenceGraceSeconds: 60,
  ollamaUrl: 'http://192.168.0.100:11434', model: 'qwen3.5:4b', presenceSource: 'manual'
};

export function newState() {
  return { presence: 'unknown', absentSince: null, timer: {
    phase: 'focus', status: 'idle', remainingMs: defaults.focusMinutes * 60000,
    deadline: null, pauseReason: null
  }, completed: {} };
}

export function dayKey(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// Apply absence at its actual deadline, even if the host was asleep or stopped.
export function reconcile(state, settings, now = Date.now()) {
  const t = state.timer;
  if (t.status !== 'running') return false;
  let pauseAt = Infinity;
  if (state.presence === 'absent' && state.absentSince !== null) {
    if (settings.absencePolicy === 'pause') pauseAt = state.absentSince;
    if (settings.absencePolicy === 'grace') pauseAt = state.absentSince + settings.absenceGraceSeconds * 1000;
  }
  if (pauseAt !== Infinity) pauseAt = Math.max(pauseAt, t.startedAt ?? 0);
  if (pauseAt <= now && pauseAt < t.deadline) {
    t.remainingMs = Math.max(0, t.deadline - pauseAt);
    t.status = 'paused'; t.pauseReason = 'absence'; t.deadline = null;
    return true;
  }
  if (now >= t.deadline) {
    if (t.phase === 'focus') {
      const day = dayKey(t.deadline);
      state.completed[day] = (state.completed[day] || 0) + 1;
    }
    t.status = 'completed'; t.remainingMs = 0; t.deadline = null; t.pauseReason = null;
    return true;
  }
  return false;
}

export function timerAction(state, settings, action, now = Date.now()) {
  reconcile(state, settings, now);
  const t = state.timer;
  if (action === 'start') {
    if (t.status !== 'idle') throw new Error('請先重設，或使用繼續計時。');
    t.remainingMs = settings[t.phase === 'focus' ? 'focusMinutes' : 'breakMinutes'] * 60000;
    t.status = 'running'; t.deadline = now + t.remainingMs; t.startedAt = now; t.pauseReason = null;
  } else if (action === 'pause') {
    if (t.status !== 'running') throw new Error('目前沒有正在進行的計時。');
    t.remainingMs = Math.max(0, t.deadline - now); t.deadline = null;
    t.status = 'paused'; t.pauseReason = 'manual';
  } else if (action === 'resume') {
    if (t.status !== 'paused') throw new Error('目前沒有暫停的計時。');
    if (state.presence === 'absent' && settings.absencePolicy !== 'continue') throw new Error('請先切換為在席，或將離席策略改為繼續計時。');
    t.status = 'running'; t.deadline = now + t.remainingMs; t.startedAt = now; t.pauseReason = null;
  } else if (action === 'reset') {
    t.status = 'idle'; t.deadline = null; t.pauseReason = null;
    t.remainingMs = settings[t.phase === 'focus' ? 'focusMinutes' : 'breakMinutes'] * 60000;
  } else if (action === 'next') {
    if (t.status !== 'completed') throw new Error('請先完成目前這一段計時。');
    t.phase = t.phase === 'focus' ? 'break' : 'focus'; t.status = 'idle';
    t.remainingMs = settings[t.phase === 'focus' ? 'focusMinutes' : 'breakMinutes'] * 60000;
  } else throw new Error('不支援的計時操作。');
  reconcile(state, settings, now);
}

export function setPresence(state, settings, presence, now = Date.now()) {
  if (!['present', 'absent', 'unknown'].includes(presence)) throw new Error('在席狀態不正確。');
  reconcile(state, settings, now);
  if (state.presence !== presence) {
    state.presence = presence;
    state.absentSince = presence === 'absent' ? now : null;
  }
  reconcile(state, settings, now);
}

export function validateSettings(input) {
  const result = {};
  for (const [key, min, max] of [['focusMinutes', 1, 180], ['breakMinutes', 1, 60], ['absenceGraceSeconds', 1, 3600]]) {
    if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error(`${key} 必須介於 ${min} 與 ${max}。`);
    result[key] = input[key];
  }
  if (!['continue', 'pause', 'grace'].includes(input.absencePolicy)) throw new Error('離席策略不正確。');
  result.absencePolicy = input.absencePolicy;
  result.presenceSource = input.presenceSource || 'manual';
  if (!['manual','camera'].includes(result.presenceSource)) throw new Error('在席來源不正確。');
  const url = new URL(input.ollamaUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('請填寫 Ollama 主機網址，不包含路徑或帳密。');
  result.ollamaUrl = url.origin;
  if (typeof input.model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,120}$/.test(input.model)) throw new Error('模型名稱不正確。');
  result.model = input.model;
  return result;
}
