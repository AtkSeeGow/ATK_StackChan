"""Reuse the selected synthetic R2 reference; no live audio or service changes."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.tools' / 'voice-design'
os.environ['HF_HOME'] = str(WORK / 'huggingface')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
import torch
from qwen_tts import Qwen3TTSModel

MODEL = 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'
REVISION = 'fd4b254389122332181a7c3db7f27e918eec64e3'
REFERENCE = WORK / 'opening-revisions' / 'A1-R2.wav'
REF_TEXT = '哼，雜魚，總算肯開始了？那就先專心五分鐘吧。'
CASES = [
    ('R2-full', '完整三種情境', '哼，雜魚，總算肯開始了？那就先專心五分鐘吧。欸，這一段做完了耶。還不錯嘛，稍微誇你一下。累了就休息一下啦。我又沒有要催你……真的。'),
    ('R2-new-playful', '新句子：得意調侃', '欸，剛剛那題不是做得挺好的嘛。別急著得意喔，下一題我可還在看著呢。'),
    ('R2-new-gentle', '新句子：放柔關心', '今天已經很努力了，先喝口水，讓眼睛休息一下吧。剩下的慢慢來，我會陪著你。'),
]

def normalize(audio):
    audio = np.asarray(audio, dtype=np.float64).reshape(-1)
    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError('Invalid audio')
    rms = float(np.sqrt(np.mean(audio ** 2)))
    if rms < 1e-6:
        raise ValueError('Silent audio')
    gain = min(10 ** (-24 / 20) / rms, 0.85 / float(np.max(np.abs(audio))))
    return audio * gain

def main():
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA required; no CPU fallback')
    out = WORK / 'consistent-r2'
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / 'manifest.json'
    reference_hash = hashlib.sha256(REFERENCE.read_bytes()).hexdigest()
    previous = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    records = previous.get('cases', []) if previous.get('revision') == REVISION and previous.get('reference_sha256') == reference_hash else []
    snapshot = WORK / 'huggingface' / 'hub' / ('models--' + MODEL.replace('/', '--')) / 'snapshots' / REVISION
    model = Qwen3TTSModel.from_pretrained(str(snapshot), device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa')
    reference, ref_sr = sf.read(REFERENCE, dtype='float32')
    with torch.inference_mode():
        prompt = model.create_voice_clone_prompt(ref_audio=(reference, ref_sr), ref_text=REF_TEXT, x_vector_only_mode=False)
    print('Synthetic R2 reference prompt ready on CUDA', flush=True)
    for index, (key, label, text) in enumerate(CASES):
        if any(r['id'] == key and r['text'] == text for r in records) and (out / f'{key}.wav').exists() and (out / f'{key}-17000.wav').exists():
            continue
        torch.manual_seed(6070 + index)
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize()
        started = time.perf_counter()
        with torch.inference_mode():
            wavs, sr = model.generate_voice_clone(text=text, language='Chinese', voice_clone_prompt=prompt, max_new_tokens=600)
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - started
        audio = normalize(wavs[0])
        if not 1 < len(audio) / sr <= 30:
            raise ValueError('Audition duration outside expected limits')
        sf.write(out / f'{key}.wav', audio, sr, subtype='PCM_16')
        # A real resample for future format evaluation; this does not change the API.
        from math import gcd
        divisor = gcd(sr, 17000)
        converted = resample_poly(audio, 17000 // divisor, sr // divisor)
        if float(np.max(np.abs(converted))) > 0.85:
            converted *= 0.85 / float(np.max(np.abs(converted)))
        sf.write(out / f'{key}-17000.wav', converted, 17000, subtype='PCM_16')
        record = dict(id=key, label=label, text=text, seed=6070 + index, seconds=len(audio) / sr,
            sample_rate=sr, elapsed=elapsed, peak_memory_mib=torch.cuda.max_memory_allocated() / 2**20)
        records.append(record)
        manifest_path.write_text(json.dumps(dict(model=MODEL, revision=REVISION, reference=str(REFERENCE.relative_to(ROOT)),
            reference_sha256=reference_hash, reference_text=REF_TEXT, torch=torch.__version__,
            normalization='RMS -24 dBFS target, peak <= 0.85; not LUFS', cases=records), ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(record, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
