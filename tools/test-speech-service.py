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
    def test_synthesis(self):
        calls=[]
        def synthesize(text):
            calls.append(text)
            return bytes(34000)
        token='t'*64
        server=module.create_server(Model(),token,port=0,synthesizer=synthesize)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(server.server_port)
        def request(value,authorized=True):
            headers={'Content-Type':'application/json'}
            if authorized: headers['Authorization']='Bearer '+token
            return urllib.request.urlopen(urllib.request.Request(base+'/synthesize',data=json.dumps(value).encode(),headers=headers))
        try:
            with self.assertRaises(urllib.error.HTTPError) as err: request({'text':'test'},False)
            self.assertEqual(err.exception.code,401)
            for value in ({'text':''},{'text':'x'*201},{'text':42},[]):
                with self.assertRaises(urllib.error.HTTPError) as err: request(value)
                self.assertEqual(err.exception.code,400)
            self.assertEqual(calls,[])
            with request({'text':'測試語音'}) as response:
                self.assertEqual(response.read(),bytes(34000))
                self.assertEqual(response.headers['X-Audio-Sample-Rate'],'17000')
                self.assertEqual(response.headers['Cache-Control'],'no-store')
            self.assertEqual(calls,['測試語音'])
            # Engine failure must be a generic HTTP error, without input text.
            def fail(text): raise RuntimeError('private '+text)
            # A separate server avoids changing the active handler closure.
            failed=module.create_server(Model(),token,port=0,synthesizer=fail)
            failed_thread=threading.Thread(target=failed.serve_forever,daemon=True);failed_thread.start()
            try:
                req=urllib.request.Request('http://127.0.0.1:'+str(failed.server_port)+'/synthesize',data=b'{"text":"secret"}',headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
                with self.assertRaises(urllib.error.HTTPError) as err: urllib.request.urlopen(req)
                self.assertEqual(err.exception.code,500)
                self.assertNotIn(b'secret',err.exception.read())
            finally: failed.shutdown();failed.server_close();failed_thread.join()
        finally: server.shutdown();server.server_close();thread.join()
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
