"""Private stdio worker. Only synthetic reference is read; requests stay in RAM."""
import base64
import contextlib
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.tools' / 'voice-design'
REVISION = 'fd4b254389122332181a7c3db7f27e918eec64e3'
REFERENCE_HASH = '97035352331fc6ead8ce9c1d8710d73879e95f2c20cef4da10a0d46b9f43cd6e'


def main():
    # Third-party progress and warnings must not corrupt the private protocol.
    wire = sys.stdout
    wire.reconfigure(encoding='utf-8')
    sys.stdin.reconfigure(encoding='utf-8')
    os.environ['HF_HOME'] = str(WORK / 'huggingface')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
        import numpy as np
        import soundfile as sf
        import torch
        from scipy.signal import resample_poly
        from math import gcd
        from qwen_tts import Qwen3TTSModel

        torch.set_num_threads(4)
        torch.set_num_interop_threads(1)
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA required')
        reference_path = WORK / 'opening-revisions' / 'A1-R2.wav'
        if hashlib.sha256(reference_path.read_bytes()).hexdigest() != REFERENCE_HASH:
            raise RuntimeError('Reference mismatch')
        snapshot = WORK / 'huggingface' / 'hub' / 'models--Qwen--Qwen3-TTS-12Hz-1.7B-Base' / 'snapshots' / REVISION
        model = Qwen3TTSModel.from_pretrained(str(snapshot), device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa')
        reference, rate = sf.read(reference_path, dtype='float32')
        with torch.inference_mode():
            prompt = model.create_voice_clone_prompt(ref_audio=(reference, rate),
                ref_text='哼，雜魚，總算肯開始了？那就先專心五分鐘吧。', x_vector_only_mode=False)
        wire.write('{"ready":true}\n'); wire.flush()
        for line in sys.stdin:
            try:
                value = json.loads(line)
                text = value.get('text')
                if not isinstance(text, str) or not text.strip() or len(text) > 200:
                    raise ValueError('Invalid text')
                # Same settings as the accepted audition; cap runaway generations.
                torch.manual_seed(6070)
                with torch.inference_mode():
                    wavs, sr = model.generate_voice_clone(text=text, language='Chinese', voice_clone_prompt=prompt, max_new_tokens=450)
                audio = np.asarray(wavs[0], dtype=np.float64).reshape(-1)
                if not len(audio) or not np.isfinite(audio).all() or len(audio) * 17000 / sr * 2 > 4194304:
                    raise ValueError('Invalid duration')
                rms = float(np.sqrt(np.mean(audio ** 2)))
                if rms < 1e-6:
                    raise ValueError('Silent audio')
                audio *= min(10 ** (-24 / 20) / rms, 0.85 / float(np.max(np.abs(audio))))
                divisor = gcd(sr, 17000)
                audio = resample_poly(audio, 17000 // divisor, sr // divisor)
                peak = float(np.max(np.abs(audio)))
                if peak > 0.85:
                    audio *= 0.85 / peak
                pcm = np.rint(np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes()
                if not pcm or len(pcm) > 4194304:
                    raise ValueError('Invalid PCM')
                result = {'pcm': base64.b64encode(pcm).decode('ascii')}
            except Exception:
                result = {'error': 'Character synthesis failed'}
            wire.write(json.dumps(result) + '\n'); wire.flush()


if __name__ == '__main__':
    main()
