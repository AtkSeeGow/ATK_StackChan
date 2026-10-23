import unittest, importlib.util, pathlib, threading, urllib.request, urllib.error, json, io, wave
from types import SimpleNamespace
module_path=pathlib.Path(__file__).resolve().parents[1]/'services'/'speech'/'server.py'
spec=importlib.util.spec_from_file_location('speech_server',module_path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Model:
    def transcribe(self,data,**kwargs):
        assert kwargs['language']=='zh'
        return [SimpleNamespace(text='測試文字',no_speech_prob=0.01,avg_logprob=-0.1)], None
class SpeechTests(unittest.TestCase):
    def test_api(self):
        token='t'*64
        server=module.create_server(Model(),token,port=0)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(server.server_port)
        try:
            with self.assertRaises(urllib.error.HTTPError) as err: urllib.request.urlopen(base+'/health')
            self.assertEqual(err.exception.code,401)
            req=urllib.request.Request(base+'/health',headers={'Authorization':'Bearer '+token})
            self.assertTrue(json.load(urllib.request.urlopen(req))['ready'])
            stream=io.BytesIO()
            with wave.open(stream,'wb') as wav:
                wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(17000);wav.writeframes(bytes(170000))
            req=urllib.request.Request(base+'/transcribe',data=stream.getvalue(),headers={'Authorization':'Bearer '+token,'Content-Type':'audio/wav'})
            self.assertEqual(json.load(urllib.request.urlopen(req))['text'],'測試文字')
            req=urllib.request.Request(base+'/transcribe',data=b'bad',headers={'Authorization':'Bearer '+token,'Content-Type':'audio/wav'})
            with self.assertRaises(urllib.error.HTTPError) as err: urllib.request.urlopen(req)
            self.assertEqual(err.exception.code,400)
        finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':unittest.main()
