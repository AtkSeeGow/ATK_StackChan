import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { encodeDisplay, expressions } from './device.mjs';

export function sameSecret(actual, expected) {
  if (!actual || !expected) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export class RemoteDevice {
  constructor(token) {
    if (token && token.length < 32) throw new Error('Device token must contain at least 32 characters');
    this.token = token; this.session = randomBytes(4).toString('hex'); this.seq = 0;
    this.lastAck = 0; this.pending = new Map(); this.applied = null;
  }
  authorized(header) { return !!this.token && sameSecret(header, `Bearer ${this.token}`); }
  issue(state, expression, effects = {flags:0,id:'00000000',code:'n'}, now = Date.now()) {
    if (this.seq >= 0xfffffffe) { this.session = randomBytes(4).toString('hex'); this.seq = 0; this.lastAckSeq = 0; this.lastAck = 0; this.pending.clear(); }
    const seq = ++this.seq;
    const frame = encodeDisplay(this.session, seq, state, expression, effects);
    this.pending.set(seq, {time:now,expression,status:state.timer.status,remaining:Math.ceil(state.timer.remainingMs / 1000),effectId:effects.id});
    for (const [key,value] of this.pending) if (now-value.time > 10000 || this.pending.size > 8) this.pending.delete(key);
    return frame;
  }
  acknowledge(message, now = Date.now()) {
    const issued = this.pending.get(message.seq);
    if (!issued || now-issued.time > 10000 || message.type !== 'sync_ack' || message.protocol !== 2 || message.session !== this.session || !expressions.includes(message.expression) || message.expression !== issued.expression || message.status !== issued.status || message.remaining_seconds !== issued.remaining || message.effect_id !== issued.effectId) return false;
    if (message.seq <= (this.lastAckSeq || 0)) return false;
    this.pending.delete(message.seq); this.lastAckSeq = message.seq; this.lastAck = now;
    this.applied = { expression:message.expression,status:message.status,remainingSeconds:message.remaining_seconds,renderCount:message.render_count,
      audioReady:typeof message.audio_ready==='boolean' ? message.audio_ready : null,effectId:message.effect_id,motionBusy:message.motion_busy===true,screenSleeping:message.screen_sleeping===true };
    return true;
  }
  snapshot() {
    const connected = this.lastAck > 0 && Date.now()-this.lastAck < 12000;
    return {connected,transport:'wifi',port:'Wi-Fi',lastAck:this.lastAck || null,applied:this.applied,
      detail:connected ? 'Wi-Fi 狀態同步中' : this.token ? '等待 Wi-Fi 裝置回應' : '尚未設定裝置金鑰'};
  }
}
