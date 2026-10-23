import unittest
from vision import Vision, cv2, np

class VisionTests(unittest.TestCase):
    def jpeg(self,image):
        ok,data = cv2.imencode('.jpg',image)
        self.assertTrue(ok)
        return data.tobytes()

    def test_dark_frame_is_unknown_and_cannot_be_calibrated(self):
        vision = Vision()
        result = vision.analyze(self.jpeg(np.zeros((240,320,3),np.uint8)),calibrate=True)
        self.assertEqual(result['candidate'],'unknown')
        self.assertFalse(result['baseline'])

    def test_explicit_empty_scene_calibration_and_reset_stay_in_memory(self):
        vision = Vision()
        y,x = np.indices((240,320))
        gray = (((x//16+y//16)%2)*100+70).astype(np.uint8)
        image = cv2.cvtColor(gray,cv2.COLOR_GRAY2BGR)
        jpeg = self.jpeg(image)
        self.assertEqual(vision.analyze(jpeg)['candidate'],'unknown')
        result = vision.analyze(jpeg,calibrate=True)
        self.assertTrue(result['baseline'])
        self.assertEqual(vision.analyze(jpeg)['candidate'],'absent')
        vision.reset()
        self.assertFalse(vision.analyze(jpeg)['baseline'])

if __name__ == '__main__': unittest.main()
