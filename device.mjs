import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const expressions = ['neutral', 'happy', 'teasing', 'concerned'];
export function encodeDisplay(session, seq, state, expression) {
  const t = state.timer;
  const seconds = Math.max(0, Math.min(10800, Math.ceil(t.remainingMs / 1000)));
  return `S|${session}|${seq}|${seconds}|${t.phase === 'focus' ? 'f' : 'b'}|${({idle:'i',running:'r',paused:'p',completed:'c'})[t.status]}|${({neutral:'n',happy:'h',teasing:'t',concerned:'c'})[expression] || 'n'}|${({present:'p',absent:'a',unknown:'u'})[state.presence]}\n`;
}

export class DeviceLink {
  constructor(root, getState, getExpression, { port = process.env.STACKCHAN_SERIAL_PORT || 'COM4', python = process.env.STACKCHAN_PYTHON || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'), onCamera = () => {}, cameraControl = () => [] } = {}) {
    this.port = port; this.getState = getState; this.getExpression = getExpression;
    this.session = randomBytes(4).toString('hex'); this.seq = 0; this.lastAck = 0; this.lastAckSeq = 0;
    this.onCamera = onCamera; this.cameraControl = cameraControl;
    this.detail = '尚未收到裝置確認'; this.closed = false;
    if (port === 'off') { this.detail = 'USB 同步已停用'; return; }
    if (!existsSync(python) || !existsSync(path.join(root, '.tools/python/serial'))) { this.detail = 'USB 工具未安裝，請參閱操作說明'; return; }
    const launch = () => {
      if (this.closed) return;
      this.lastAck = 0; this.buffer = ''; this.lastAckSeq = 0;
      const child = spawn(python, ['-u', path.join(root, 'tools/serial-bridge.py'), '--port', port], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
      this.child = child;
      child.stdin.on('error', () => {});
      child.stdout.on('data', data => {
        this.buffer += data.toString();
        if (this.buffer.length > 262144) this.buffer = '';
        let end;
        while ((end = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0,end); this.buffer = this.buffer.slice(end+1);
          try { this.accept(JSON.parse(line)); } catch { /* Ignore boot logs and partial frames. */ }
        }
      });
      child.stderr.on('data', () => { this.detail = 'USB 橋接工具錯誤'; });
      child.on('error', () => { this.detail = '無法啟動 USB 橋接工具'; });
      child.on('close', () => {
        this.child = null; this.lastAck = 0; this.detail = 'USB 橋接已中斷，正在重連';
        if (!this.closed) { this.retry = setTimeout(launch, 3000); this.retry.unref(); }
      });
    };
    launch();
    this.tick = setInterval(() => {
      if (!this.child?.stdin.writable || this.child.stdin.writableLength > 1024) return;
      if (this.seq >= 0xfffffffe) { this.session = randomBytes(4).toString('hex'); this.seq = 0; this.lastAckSeq = 0; this.lastAck = 0; }
      this.child.stdin.write(encodeDisplay(this.session, ++this.seq, this.getState(), this.getExpression()));
      for (const command of this.cameraControl()) this.child.stdin.write(command);
    }, 1000);
    this.tick.unref();
  }
  accept(message, now = Date.now()) {
    if (['camera_frame','camera_status'].includes(message.type)) { this.onCamera(message); return; }
    if (message.type === 'bridge_status') {
      this.detail = message.status === 'open' ? '等待裝置確認' : 'USB 未連線，正在重連';
      if (message.status !== 'open') this.lastAck = 0;
    }
    if (message.type !== 'sync_ack' || message.protocol !== 1 || message.session !== this.session || !Number.isInteger(message.seq) || message.seq <= this.lastAckSeq || message.seq > this.seq || message.seq < this.seq - 3 || !expressions.includes(message.expression) || !['idle','running','paused','completed'].includes(message.status) || !Number.isInteger(message.remaining_seconds) || message.remaining_seconds < 0 || message.remaining_seconds > 10800) return;
    this.lastAck = now; this.lastAckSeq = message.seq; this.detail = '番茄鐘與表情同步中';
    this.applied = { expression: message.expression, status: message.status, remainingSeconds: message.remaining_seconds, renderCount: message.render_count };
  }
  snapshot() {
    return { connected: this.lastAck > 0 && Date.now() - this.lastAck < 5000, port: this.port, detail: this.lastAck > 0 && Date.now() - this.lastAck >= 5000 ? '裝置未回應，正在重連' : this.detail, lastAck: this.lastAck || null, applied: this.applied || null };
  }
  close() { this.closed = true; clearInterval(this.tick); clearTimeout(this.retry); this.child?.kill(); }
}
