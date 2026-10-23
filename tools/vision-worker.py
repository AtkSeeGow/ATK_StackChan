"""Local stdin/stdout image analysis; never writes images."""
import sys, json, base64
from vision import Vision
vision = Vision()
for line in sys.stdin:
    try:
        item = json.loads(line)
        if item.get('reset'):
            vision.reset()
            continue
        jpeg = base64.b64decode(item['jpeg'], validate=True)
        result = vision.analyze(jpeg, item.get('calibrate') is True)
        print(json.dumps(result), flush=True)
    except Exception:
        print(json.dumps({'candidate':'unknown','reason':'本機影像分析失敗','faces':0,'baseline':False}), flush=True)
