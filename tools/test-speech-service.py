import unittest, importlib.util, pathlib, threading, urllib.request, urllib.error, json, io, wave, queue, base64
from unittest.mock import Mock, patch
from types import SimpleNamespace
module_path=pathlib.Path(__file__).resolve().parents[1]/'services'/'speech'/'server.py'
spec=importlib.util.spec_from_file_location('speech_server',module_path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
character_spec=importlib.util.spec_from_file_location('character',module_path.with_name('character.py'))
character=importlib.util.module_from_spec(character_spec);character_spec.loader.exec_module(character)
class Model:
    def transcribe(self,data,**kwargs):
        assert kwargs['language']=='zh'
        return [SimpleNamespace(text='測試文字',no_speech_prob=0.01,avg_logprob=-0.1)], None
class SpeechTests(unittest.TestCase):
    def test_character_startup_protocol(self):
        synth=character.CharacterSynthesizer(Mock())
        process=Mock();process.poll.return_value=None
        process.stdout=io.StringIO('{"ready":true}\n');process.stdin=io.StringIO()
        with patch.object(character.subprocess,'Popen',return_value=process) as spawn, patch.dict(character.os.environ,{'STT_TOKEN':'private-test-token'}):
            synth.start()
            self.assertNotIn('STT_TOKEN',spawn.call_args.kwargs['env'])
            self.assertEqual(synth.metadata()['engine'],'qwen3-local')
            synth.close()
        process=Mock();process.poll.return_value=None
        process.stdout=io.StringIO('{"error":"private details"}\n');process.stdin=io.StringIO()
        with patch.object(character.subprocess,'Popen',return_value=process):
            with self.assertRaisesRegex(RuntimeError,'^Character startup failed$'):synth.start()
        self.assertIsNone(synth.process)

    def test_character_protocol_and_fallback(self):
        fallback=Mock(return_value=b'\x01\x00')
        synth=character.CharacterSynthesizer(fallback,timeout=0)
        synth.recover=Mock()
        def ready(value=None):
            process=Mock();process.poll.return_value=None
            synth.process=process;synth.messages=queue.Queue()
            if value is not None:synth.messages.put(value)
            return process
        process=ready({'pcm':base64.b64encode(b'\x02\x00').decode()})
        self.assertEqual(synth('測試'),b'\x02\x00')
        fallback.assert_not_called()
        self.assertEqual(synth.metadata()['last_engine'],'qwen3-local')
        # Timeout destroys the worker, then falls back without stale responses.
        ready()
        self.assertEqual(synth('測試'),b'\x01\x00')
        self.assertIsNone(synth.process)
        self.assertEqual(synth.metadata()['fallback_count'],1)
        self.assertEqual(synth.metadata()['last_fallback_reason'],'timeout')
        synth.recover.assert_called_once()
        for value in ({'error':'private internal text'},{'pcm':'bad base64'},{'pcm':'AQ=='},{'pcm':''}):
            process=ready(value)
            self.assertEqual(synth('測試'),b'\x01\x00')
            process.kill.assert_called_once()
        calls=fallback.call_count
        with self.assertRaises(ValueError):synth('x'*201)
        self.assertEqual(fallback.call_count,calls)
        self.assertEqual(synth.metadata()['last_engine'],'windows-local')

    def test_character_long_text_and_duration(self):
        text='這是一段合成測試，請依照標點分段。'*7
        parts=character.CharacterSynthesizer.chunks(text)
        self.assertEqual(''.join(parts),text)
        self.assertTrue(all(len(part)<=32 for part in parts))
        fallback=Mock()
        synth=character.CharacterSynthesizer(fallback)
        synth.process=Mock();synth.process.poll.return_value=None
        synth.messages=queue.Queue()
        for part in parts:synth.messages.put({'pcm':base64.b64encode(b'\x02\x00').decode()})
        self.assertEqual(synth(text),b'\x02\x00'*len(parts))
        fallback.assert_not_called()
        synth.messages.put({'pcm':base64.b64encode(bytes(1360000)).decode()})
        self.assertEqual(len(synth('超過三十秒')),1360000)
        synth.messages.put({'pcm':base64.b64encode(bytes(4194306)).decode()})
        with self.assertRaises(OverflowError):synth('超長音訊')
        synth.process.kill.assert_not_called()
        fallback.assert_not_called()

    def test_character_background_recovery(self):
        synth=character.CharacterSynthesizer(Mock(return_value=b'\x01\x00'))
        def start():
            synth.process=Mock();synth.process.poll.return_value=None
            synth.messages=queue.Queue()
            synth.messages.put({'pcm':base64.b64encode(b'\x02\x00').decode()})
        synth.start=Mock(side_effect=start)
        self.assertEqual(synth('失敗後恢復'),b'\x01\x00')
        synth.recovery.join(3)
        self.assertFalse(synth.recovery.is_alive())
        self.assertEqual(synth('恢復後'),b'\x02\x00')
        synth.start.assert_called_once()
        synth.shutdown()

    def test_character_health_and_audio_lock(self):
        entered=threading.Event();release=threading.Event()
        class Synth:
            def metadata(self):return {'engine':'qwen3-local','device':'cuda','voice':'R2'}
            def __call__(self,text):
                entered.set();release.wait(5);return b'\x01\x00'
        token='t'*64
        server=module.create_server(Model(),token,port=0,synthesizer=Synth())
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(server.server_port)
        headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
        results=[]
        def synthesize():
            with urllib.request.urlopen(urllib.request.Request(base+'/synthesize',data=b'{"text":"test"}',headers=headers)) as response:results.append(response.read())
        caller=threading.Thread(target=synthesize)
        try:
            caller.start();self.assertTrue(entered.wait(3))
            with urllib.request.urlopen(urllib.request.Request(base+'/health',headers=headers)) as response:
                self.assertEqual(json.load(response)['tts']['voice'],'R2')
            for path,content in (('/synthesize','application/json'),('/transcribe','audio/wav')):
                req=urllib.request.Request(base+path,data=b'{}',headers={**headers,'Content-Type':content})
                with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(req)
                self.assertEqual(err.exception.code,429)
        finally:
            release.set();caller.join();server.shutdown();server.server_close();thread.join()
        self.assertEqual(results,[b'\x01\x00'])

    def test_synthesis(self):
        calls=[]
        def synthesize(text):
            calls.append(text)
            return bytes(1360000)
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
                self.assertEqual(response.read(),bytes(1360000))
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
