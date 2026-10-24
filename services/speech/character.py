"""Isolated, persistent GPU TTS with bounded deadlines and Windows fallback."""
import base64
import json
import os
from pathlib import Path
import queue
import subprocess
import threading


class CharacterSynthesizer:
    def __init__(self, fallback, timeout=36):
        self.fallback = fallback
        self.timeout = timeout
        self.process = None
        self.messages = None
        self.last_engine = None
        self.fallback_count = 0
        self.lock = threading.Lock()

    def metadata(self):
        ready=self.process is not None and self.process.poll() is None
        return dict(engine='qwen3-local' if ready else 'windows-local', device='cuda' if ready else 'cpu',
            configured_engine='qwen3-local', voice='R2', sample_rate=17000, ready=ready,
            fallback_engine='windows-local', last_engine=self.last_engine, fallback_count=self.fallback_count)

    def close(self):
        process, self.process = self.process, None
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
            process.stdin.close()
            process.stdout.close()

    def start(self):
        if self.process is not None and self.process.poll() is None:
            return
        self.close()
        root = Path(__file__).resolve().parents[2]
        executable = root / '.tools/voice-design/.venv/Scripts/python.exe'
        worker = Path(__file__).with_name('character_worker.py')
        self.messages = messages = queue.Queue(maxsize=2)
        self.process = process = subprocess.Popen([str(executable), '-u', str(worker)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env={key:value for key,value in os.environ.items() if key!='STT_TOKEN'},
            text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

        def receive():
            try:
                while True:
                    line = process.stdout.readline(1400000)
                    if not line or not line.endswith('\n'):
                        break
                    messages.put(json.loads(line), timeout=1)
            except Exception:
                pass
            finally:
                try:
                    messages.put({'error': 'Worker exited'}, timeout=1)
                except queue.Full:
                    pass
        threading.Thread(target=receive, daemon=True).start()
        try:
            if self.messages.get(timeout=180) != {'ready': True}:
                raise RuntimeError('Character startup failed')
        except Exception:
            self.close()
            raise RuntimeError('Character startup failed') from None

    def __call__(self, text):
        if not isinstance(text, str) or not text.strip() or len(text) > 200:
            raise ValueError('Text must contain 1-200 characters')
        with self.lock:
            # Do not cold-load on an HTTP request: .199 allows 50 seconds total.
            try:
                if self.process is None or self.process.poll() is not None:
                    raise RuntimeError('Character unavailable')
                self.process.stdin.write(json.dumps({'text': text}) + '\n')
                self.process.stdin.flush()
                value = self.messages.get(timeout=self.timeout)
                pcm = base64.b64decode(value['pcm'], validate=True)
                if not pcm or len(pcm) % 2 or len(pcm) > 1020000:
                    raise ValueError('Invalid PCM')
                self.last_engine = 'qwen3-local'
                return pcm
            except Exception:
                self.close()
                self.fallback_count += 1
                self.last_engine = 'windows-local'
                return self.fallback(text)
