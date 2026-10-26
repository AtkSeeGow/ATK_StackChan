"""Send one allow-listed motor safety command over USB and print its response."""

import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".tools" / "python"))
import serial


COMMANDS = {
    "probe": "M|probe\n",
    "raw": "M|raw\n",
    "off": "M|off\n",
    "yaw-minus-3": "M|yaw|-3\n",
    "yaw-plus-3": "M|yaw|+3\n",
    "yaw-home": "M|yaw|home\n",
    "yaw-open-loop-3": "M|yaw|open-loop-3\n",
    "yaw-open-loop-6": "M|yaw|open-loop-6\n",
    "yaw-sweep-15": "M|yaw|sweep-15\n",
    "yaw-sweep-30": "M|yaw|sweep-30\n",
}

parser = argparse.ArgumentParser()
parser.add_argument("command", choices=COMMANDS)
parser.add_argument("--port", default="COM4")
parser.add_argument("--timeout", type=float, default=10.0)
args = parser.parse_args()

port = serial.Serial(port=None, baudrate=115200, timeout=0.1, write_timeout=1)
port.port = args.port
port.dtr = False
port.rts = False

try:
    port.open()
    time.sleep(0.25)
    port.reset_input_buffer()
    port.write(COMMANDS[args.command].encode("ascii"))
    port.flush()
    deadline = time.monotonic() + args.timeout
    buffer = b""
    while time.monotonic() < deadline:
        buffer += port.read(4096)
        if len(buffer) > 65536:
            buffer = b""
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            try:
                message = json.loads(line)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if isinstance(message, dict) and message.get("type") == "motor_safety":
                print(json.dumps(message, ensure_ascii=False), flush=True)
                raise SystemExit(0 if message.get("ok") else 2)
    raise TimeoutError(f"No motor safety response from {args.port} within {args.timeout:g} seconds")
finally:
    if port.is_open:
        port.close()
