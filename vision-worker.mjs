import { spawn } from 'node:child_process';
import path from 'node:path';
export class VisionWorker {
  constructor(root) { this.root = root; this.pending = null; this.buffer = ''; }
  launch() {
    if (this.child) return;
    const python = process.env.STACKCHAN_PYTHON || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
    const child = spawn(python,['-u',path.join(this.root,'tools/vision-worker.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    this.child = child;
    child.stdin.on('error',()=>{});
    child.stderr.on('data',()=>{});
    child.stdout.on('data',data=>{
      if (this.child !== child) return;
      this.buffer += data.toString();
      if (this.buffer.length > 4096) { this.close(); return; }
      let end;
      while ((end=this.buffer.indexOf('\n'))>=0) {
        const line=this.buffer.slice(0,end); this.buffer=this.buffer.slice(end+1);
        try { this.finish(JSON.parse(line)); } catch { this.finish(null); }
      }
    });
    child.on('error',()=>{if(this.child===child) this.finish(null);});
    child.on('close',()=>{ if(this.child!==child) return; this.child=null; this.finish(null); });
  }
  finish(value) { if(this.pending) { const {resolve,timer}=this.pending; this.pending=null; clearTimeout(timer); resolve(value); } }
  async analyze(jpeg,calibrate) {
    if(this.pending) throw new Error('影像分析忙碌中');
    this.launch();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>this.close(),5000);
      this.pending={resolve,timer};
      this.child.stdin.write(JSON.stringify({jpeg:jpeg.toString('base64'),calibrate})+'\n');
    });
  }
  close() { const child=this.child; this.child=null; this.buffer=''; this.finish(null); child?.kill(); }
}
