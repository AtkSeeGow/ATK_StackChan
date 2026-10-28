"""Isolated, persistent GPU TTS with bounded deadlines and Windows fallback."""
import base64
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
import re


class CharacterSynthesizer:
    def __init__(self, fallback, timeout=60):
        self.fallback = fallback
        self.timeout = timeout
        self.process = None
        self.messages = None
        self.last_engine = None
        self.fallback_count = 0
        self.lock = threading.Lock()
        self.recovery = None
        self.retry_at = 0
        self.stopping = False
        self.last_fallback_reason = None
        self.last_chunks = 0

    def metadata(self):
        recovering=self.recovery is not None and self.recovery.is_alive()
        ready=not recovering and self.process is not None and self.process.poll() is None
        return dict(engine='qwen3-local' if ready else 'windows-local', device='cuda' if ready else 'cpu',
            configured_engine='qwen3-local', voice='R2', sample_rate=17000, ready=ready,
            fallback_engine='windows-local', last_engine=self.last_engine, fallback_count=self.fallback_count,
            recovering=recovering, last_fallback_reason=self.last_fallback_reason, last_chunks=self.last_chunks)

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
                    line = process.stdout.readline(5600000)
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

    def recover(self):
        if self.stopping or time.monotonic() < self.retry_at or (self.recovery and self.recovery.is_alive()):
            return
        self.retry_at = time.monotonic() + 60
        def run():
            with self.lock:
                if self.stopping:
                    return
                try:
                    self.start()
                except Exception:
                    self.last_fallback_reason = 'recovery_failed'
                    self.retry_at = time.monotonic() + 60
        self.recovery = threading.Thread(target=run, daemon=True)
        self.recovery.start()

    def shutdown(self):
        self.stopping = True
        with self.lock:
            self.close()

    @staticmethod
    def chunks(text):
        result, pending = [], ''
        for part in re.split(r'(?<=[。！？!?；;，,、：:\n])', text):
            if pending and len(pending) + len(part) > 32:
                result.append(pending)
                pending = ''
            while len(part) > 32:
                result.append(part[:32])
                part = part[32:]
            pending += part
        if pending:
            result.append(pending)
        return [part for part in result if part.strip()]

    def __call__(self, text):
        if not isinstance(text, str) or not text.strip() or len(text) > 200:
            raise ValueError('Text must contain 1-200 characters')
        if self.recovery and self.recovery.is_alive():
            self.last_engine = 'windows-local'
            self.last_fallback_reason = 'recovering'
            self.fallback_count += 1
            return self.fallback(text)
        with self.lock:
            started = time.monotonic()
            reason = 'worker_unavailable'
            self.last_chunks = 0
            try:
                if self.process is None or self.process.poll() is not None:
                    raise RuntimeError('Character unavailable')
                pieces, size = [], 0
                for part in self.chunks(text):
                    remaining = 165 - (time.monotonic() - started)
                    if remaining <= 0:
                        raise queue.Empty()
                    reason = 'worker_io'
                    self.process.stdin.write(json.dumps({'text': part}) + '\n')
                    self.process.stdin.flush()
                    value = self.messages.get(timeout=min(self.timeout, remaining))
                    reason = 'worker_error'
                    if 'error' in value:
                        raise RuntimeError('Worker failed')
                    reason = 'invalid_pcm'
                    pcm = base64.b64decode(value['pcm'], validate=True)
                    if not pcm or len(pcm) % 2:
                        raise ValueError('Invalid PCM')
                    size += len(pcm)
                    if size > 4194304:
                        raise OverflowError('Audio exceeds memory budget')
                    pieces.append(pcm)
                    self.last_chunks += 1
                self.last_engine = 'qwen3-local'
                return b''.join(pieces)
            except OverflowError:
                raise
            except Exception as error:
                self.last_fallback_reason = 'timeout' if isinstance(error, queue.Empty) else reason
                self.close()
                self.fallback_count += 1
                self.last_engine = 'windows-local'
        try:
            return self.fallback(text)
        finally:
            self.recover()
