export class CameraState {
  constructor() { this.enabled = false; this.seq = 0; this.clear(); }
  clear() { this.jpeg = null; this.receivedAt = 0; this.candidate = 'unknown'; this.presence = 'unknown'; this.since = 0; this.samples = 0; this.baseline = false; this.faces = 0; this.reason = '尚未取像'; this.calibrate = false; this.error = null; }
  enable(value) { this.enabled = value; this.clear(); }
  commands() {
    const commands = [`C|${this.enabled ? 1 : 0}\n`];
    if (this.enabled && this.calibrate) { commands.push('K\n'); this.calibrate = false; }
    return commands;
  }
  accept(message, now = Date.now()) {
    if (this.enabled && message.type === 'camera_status') { this.error = String(message.error || '相機異常').slice(0,160); return false; }
    if (!this.enabled || message.type !== 'camera_frame' || typeof message.jpeg !== 'string' || message.jpeg.length > 180000) return false;
    const jpeg = Buffer.from(message.jpeg,'base64');
    if (jpeg.length < 100 || jpeg.length > 130000 || jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg.at(-2) !== 255 || jpeg.at(-1) !== 217) return false;
    const gap = this.receivedAt && now-this.receivedAt > 7000;
    this.jpeg = jpeg; this.receivedAt = now; this.seq++; this.error = null;
    this.baseline = message.baseline === true;
    this.faces = Number.isInteger(message.faces) && message.faces >= 0 ? message.faces : 0;
    this.reason = typeof message.reason === 'string' ? message.reason.slice(0,160) : '影像分析不可用';
    let candidate = message.candidate;
    if (!['present','absent'].includes(candidate) || (candidate === 'absent' && !this.baseline)) candidate = 'unknown';
    if (candidate !== this.candidate || gap) { this.candidate = candidate; this.since = now; this.samples = 1; }
    else this.samples++;
    this.presence = candidate === 'present' && this.samples >= 2 ? 'present' : candidate === 'absent' && this.samples >= 5 && now-this.since >= 10000 ? 'absent' : 'unknown';
    return true;
  }
  snapshot(now = Date.now()) {
    const fresh = this.enabled && this.receivedAt > 0 && now-this.receivedAt < 7000;
    return {enabled:this.enabled,fresh,seq:this.seq,receivedAt:this.receivedAt || null,presence:fresh ? this.presence : 'unknown',candidate:fresh ? this.candidate : 'unknown',faces:fresh ? this.faces : 0,baseline:this.baseline,reason:!this.enabled ? '預覽與辨識已停止' : this.error || (!fresh ? '等待最新影像' : this.reason)};
  }
}
