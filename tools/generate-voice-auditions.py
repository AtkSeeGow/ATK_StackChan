"""Generate synthetic-only A-direction auditions in an isolated local runtime."""
import json
import argparse
import os
import sys
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.tools' / 'voice-design'
sys.stdout.reconfigure(encoding='utf-8')
os.environ['HF_HOME'] = str(WORK / 'huggingface')
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'

import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

MODEL = 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign'
REVISION = '5ecdb67327fd37bb2e042aab12ff7391903235d3'
TEXT = '哼，雜魚，總算肯開始了？那就先專心五分鐘吧。欸，這一段做完了耶。還不錯嘛，稍微誇你一下。累了就休息一下啦。我又沒有要催你……真的。'
BASE = '中文成年年轻女性角色声线，清亮偏高，轻盈自然，咬字清楚，带笑，俏皮爱逞强。前两句轻巧得意并带一点调侃，中间夸奖时开心但故作矜持，最后关心时自然放柔，仍是同一个角色。自然语速，避免尖叫和过度气声。'
CANDIDATES = [
    ('A1', '清亮靈巧', '共鸣明亮通透，尾音灵巧上扬，笑意轻盈，像在轻快地逗朋友。'),
    ('A2', '俏皮得意', '明亮中带一点扎实的中频，语气自信，得意的小坏笑，调侃有节奏但不凶。'),
    ('A3', '柔亮帶笑', '清亮而圆润，笑意温暖，调侃轻巧，关心时柔和亲近，但不变成气声。'),
]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--opening', action='store_true', help='Generate two A1 opening-only prosody revisions')
    args = parser.parse_args()
    text = '哼，雜魚，總算肯開始了？那就先專心五分鐘吧。' if args.opening else TEXT
    candidates = [
        ('A1-R1', '開頭自然調侃', CANDIDATES[0][2] + '开头用自然说话的轻笑语气，杂鱼两个字一带而过，不刻意重读。总算肯开始了是一句连贯的口语，语调平顺，末尾轻轻上扬，不唱腔，不逐字顿挫。'),
        ('A1-R2', '開頭輕巧得意', CANDIDATES[0][2] + '开头像对熟悉的朋友开玩笑，嘴角带笑，有一点小得意。哼轻短，杂鱼轻快自然，总算肯开始了连贯清楚，避免夸张的抑扬顿挫和突然拔高音调。'),
    ] if args.opening else CANDIDATES
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA required; no automatic CPU fallback')
    out = WORK / ('opening-revisions' if args.opening else 'auditions')
    out.mkdir(parents=True, exist_ok=True)
    print(json.dumps({'gpu': torch.cuda.get_device_name(), 'torch': torch.__version__, 'cuda': torch.version.cuda}), flush=True)
    snapshot = WORK / 'huggingface' / 'hub' / ('models--' + MODEL.replace('/', '--')) / 'snapshots' / REVISION
    source = str(snapshot) if snapshot.is_dir() else MODEL
    model = Qwen3TTSModel.from_pretrained(source, revision=REVISION, device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa')
    manifest = out / 'manifest.json'
    previous = json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else {}
    records = previous.get('candidates', []) if previous.get('revision') == REVISION and previous.get('text') == text else []
    for index, (key, label, detail) in enumerate(candidates):
        if any(r['id'] == key and r['instruct'] == BASE + detail for r in records) and (out / f'{key}.wav').exists():
            continue
        seed = 5070 if args.opening else 5070 + index
        torch.manual_seed(seed)
        torch.cuda.reset_peak_memory_stats()
        started = time.perf_counter()
        with torch.inference_mode():
            wavs, sr = model.generate_voice_design(text=text, language='Chinese', instruct=BASE + detail, max_new_tokens=200 if args.opening else 600)
        audio = np.asarray(wavs[0], dtype=np.float32).reshape(-1)
        if not np.isfinite(audio).all() or len(audio) == 0:
            raise RuntimeError('Invalid generated audio')
        rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
        peak = float(np.max(np.abs(audio)))
        if rms < 1e-6:
            raise RuntimeError('Silent generated audio')
        # Same RMS target with peak protection; this is not perceptual LUFS matching.
        gain = min(10 ** (-24 / 20) / rms, 0.85 / max(peak, 1e-9))
        sf.write(out / f'{key}.wav', audio * gain, sr, subtype='PCM_16')
        record = dict(id=key, label=label, seed=seed, instruct=BASE + detail,
                      sample_rate=sr, seconds=len(audio) / sr, elapsed=time.perf_counter() - started,
                      peak_memory_mib=torch.cuda.max_memory_allocated() / 2**20,
                      gain=gain, file=f'{key}.wav')
        records.append(record)
        (out / 'manifest.json').write_text(json.dumps(dict(model=MODEL, revision=REVISION, text=text, torch=torch.__version__,
            normalization='RMS -24 dBFS target, peak <= 0.85; not LUFS', candidates=records), ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(record, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()

