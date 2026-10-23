"""USB transport only: the Node backend owns state and validates acknowledgements."""
import argparse
import json
from pathlib import Path
import queue
import sys
import threading
import time
import base64

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.tools' / 'python'))
import serial

parser = argparse.ArgumentParser()
parser.add_argument('--port', required=True)
args = parser.parse_args()
pending = queue.Queue(maxsize=1)
stopped = threading.Event()
controls = queue.Queue(maxsize=1)
calibration = threading.Event()
vision = None
vision_error = None
try:
    from vision import Vision
    vision = Vision()
except Exception:
    vision_error = '本機影像分析工具不可用'

def receive_commands():
    for line in sys.stdin:
        if line.strip() == 'K':
            calibration.set()
            continue
        if line.strip() in ('C|0','C|1'):
            try:
                controls.get_nowait()
            except queue.Empty:
                pass
            controls.put_nowait(line.encode('ascii'))
            continue
        if not line.startswith('S|') or len(line) > 120:
            continue
        try:
            pending.get_nowait()
        except queue.Empty:
            pass
        pending.put((time.monotonic(), line.encode('ascii')))
    stopped.set()

def emit(value):
    print(json.dumps(value), flush=True)

threading.Thread(target=receive_commands, daemon=True).start()
while not stopped.is_set():
    port = None
    try:
        port = serial.Serial(port=None, baudrate=115200, timeout=0.1, write_timeout=1)
        port.port = args.port
        # Avoid entering download mode or resetting a running device on open.
        port.dtr = False
        port.rts = False
        port.open()
        emit({'type': 'bridge_status', 'status': 'open'})
        buffer = b''
        while not stopped.is_set():
            while not controls.empty():
                try:
                    command = controls.get_nowait()
                    port.write(command)
                    if command.strip() == b'C|0' and vision:
                        vision.reset()
                        calibration.clear()
                except queue.Empty:
                    break
            try:
                created, command = pending.get_nowait()
                if time.monotonic() - created < 4:
                    port.write(command)
            except queue.Empty:
                pass
            buffer += port.read(4096)
            if len(buffer) > 262144:
                buffer = b''
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                try:
                    message = json.loads(line)
                    if isinstance(message, dict) and message.get('type') == 'sync_ack':
                        emit(message)
                    elif isinstance(message,dict) and message.get('type') == 'camera_status':
                        emit(message)
                    elif isinstance(message,dict) and message.get('type') == 'camera_frame' and isinstance(message.get('jpeg'),str) and len(message['jpeg']) <= 180000:
                        jpeg = base64.b64decode(message['jpeg'],validate=True)
                        if vision:
                            try:
                                analysis = vision.analyze(jpeg,calibration.is_set())
                            except Exception:
                                analysis = {'candidate':'unknown','faces':0,'baseline':False,'reason':'影像分析失敗，先標示未知'}
                            calibration.clear()
                        else:
                            analysis = {'candidate':'unknown','faces':0,'baseline':False,'reason':vision_error}
                        emit({'type':'camera_frame','jpeg':message['jpeg'],**analysis})
                except (ValueError, UnicodeDecodeError):
                    pass
    except (serial.SerialException, OSError):
        emit({'type': 'bridge_status', 'status': 'disconnected'})
        stopped.wait(1)
    finally:
        if port is not None and port.is_open:
            port.close()
