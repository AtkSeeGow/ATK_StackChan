"""Conservative face/empty-scene cues. Images and calibration stay in RAM."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.tools'/'vision-runtime'))
import cv2
import numpy as np

class Vision:
    def __init__(self):
        self.detector = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades)/'haarcascade_frontalface_default.xml'))
        if self.detector.empty():
            raise RuntimeError('Face classifier unavailable')
        self.baseline = None

    def reset(self):
        self.baseline = None

    def analyze(self, jpeg, calibrate=False):
        image = cv2.imdecode(np.frombuffer(jpeg,dtype=np.uint8),cv2.IMREAD_COLOR)
        if image is None or image.shape[:2] != (240,320):
            raise ValueError('Invalid 320x240 JPEG')
        gray = cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
        brightness, contrast = float(gray.mean()),float(gray.std())
        good = 25 < brightness < 230 and contrast > 12
        faces = self.detector.detectMultiScale(cv2.equalizeHist(gray),scaleFactor=1.1,minNeighbors=5,minSize=(28,28)) if good else []
        blurred = cv2.GaussianBlur(gray,(11,11),0)
        result = {'candidate':'unknown','faces':len(faces),'baseline':self.baseline is not None,'reason':'沒有明確在席證據，先標示未知'}
        if not good:
            result['reason'] = '畫面過暗、過亮或細節不足，無法判斷'
        elif calibrate:
            if len(faces):
                result['reason'] = '畫面仍偵測到臉，未更新空位校準'
            else:
                self.baseline = blurred.copy()
                result['baseline'] = True
                result['reason'] = '空位畫面已暫存在記憶體；相似畫面持續十秒後才判為離席'
        elif len(faces):
            result['candidate'] = 'present'
            result['reason'] = '偵測到臉部，等待連續確認'
        elif self.baseline is not None:
            difference = float(cv2.absdiff(blurred,self.baseline).mean())
            if difference < 8:
                result['candidate'] = 'absent'
                result['reason'] = '接近已校準的空位畫面，等待連續確認'
            else:
                result['reason'] = '畫面與空位不同，但沒有偵測到臉，先標示未知'
        return result
