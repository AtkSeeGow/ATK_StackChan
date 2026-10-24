"""Offline Windows voice; text and PCM remain in memory."""
import os
import pathlib
import subprocess

RATE = 17000
MAX_SECONDS = 30

def synthesize(text, timeout=45):
    if not isinstance(text, str) or not text.strip() or len(text) > 200:
        raise ValueError('Text must contain 1-200 characters')
    executable = pathlib.Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    result = subprocess.run(
        [str(executable), '-NoProfile', '-NonInteractive', '-Command', pathlib.Path(__file__).with_name('synthesize.ps1').read_text(encoding='utf-8-sig')],
        input=text.encode('utf-8'), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=timeout, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    # Do not expose engine stderr: it could include user text.
    if result.returncode:
        raise RuntimeError('Local Windows synthesis failed')
    pcm = result.stdout
    if not pcm or len(pcm) % 2 or len(pcm) > RATE * 2 * MAX_SECONDS:
        raise RuntimeError('Synthesis audio exceeds supported duration or format')
    return pcm
