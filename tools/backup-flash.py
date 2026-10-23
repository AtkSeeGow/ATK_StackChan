"""Read-only, chunked Flash backup using esptool's verified read protocol."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools' / 'python'))
import esptool

parser = argparse.ArgumentParser()
parser.add_argument('--port', default='COM4')
parser.add_argument('--output', required=True)
parser.add_argument('--size', type=int, default=16777216)
parser.add_argument('--manual', action='store_true', help='Device already in download mode')
parser.add_argument('--rom', action='store_true', help='Use slower built-in ROM reader')
args = parser.parse_args()
target = Path(args.output).resolve()
partial = target.with_suffix(target.suffix + '.partial')
target.parent.mkdir(parents=True, exist_ok=True)
if target.exists() or partial.exists():
    raise SystemExit('Refusing to overwrite an existing backup or partial file.')
start = time.time()
with esptool.detect_chip(args.port, baud=115200, connect_mode='no-reset' if args.manual else 'default-reset') as chip:
    if chip.CHIP_NAME != 'ESP32-S3':
        raise SystemExit('Unexpected chip; no backup attempted.')
    stub = chip if args.rom else esptool.run_stub(chip)
    if args.rom:
        esptool.attach_flash(stub)
        stub.flash_set_parameters(args.size)
    # Small independent reads avoid a large in-flight USB transfer. Stub reads
    # have per-chunk MD5; both modes also verify the whole Flash MD5 at the end.
    try:
        with partial.open('xb') as output:
            for offset in range(0, args.size, 16384):
                chunk = stub.read_flash(offset, min(16384, args.size - offset))
                output.write(chunk)
                if offset % 1048576 == 0:
                    print(f'Backup {offset}/{args.size} bytes', flush=True)
        if partial.stat().st_size != args.size:
            raise RuntimeError('Backup length mismatch')
        header = ROOT / 'backups' / 'stackchan-header-20261023.bin'
        if header.exists():
            with partial.open('rb') as output:
                # Exclude NVS/OTA data which factory firmware can legitimately
                # update on reboot. Bootloader and partition table are stable.
                if output.read(0x9000) != header.read_bytes()[:0x9000]:
                    raise RuntimeError('Backup header differs from independent ROM read')
        data = partial.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        device_md5 = stub.flash_md5sum(0, args.size).strip().lower()
        if hashlib.md5(data).hexdigest() != device_md5:
            raise RuntimeError('Backup differs from device Flash MD5; retaining partial file')
        partial.rename(target)
        target.with_suffix('.json').write_text(json.dumps({
            'size': args.size, 'sha256': digest, 'chip': chip.CHIP_NAME,
            'port': args.port, 'read_method': 'esptool ROM / 16KB chunks' if args.rom else 'esptool stub / 16KB chunks / per-chunk MD5',
            'header_verified_against_rom': header.exists(),
            'elapsed_seconds': round(time.time() - start, 2),
            'device_md5_verified': True, 'device_md5': device_md5,
            'boot_header_verified_bytes': 0x9000 if header.exists() else 0
        }, indent=2), encoding='utf-8')
        print(f'Backup complete: {args.size} bytes; SHA256 {digest}', flush=True)
    finally:
        stub.hard_reset()
