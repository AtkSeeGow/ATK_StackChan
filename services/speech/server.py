"""LAN speech service. Audio stays in memory; no transcript or audio logs."""
import io, os, json, wave, hmac, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

def create_server(model, token, host='127.0.0.1', port=8001, device='cpu', model_name='small', synthesizer=None):
    if len(token) < 32:
        raise ValueError('STT_TOKEN must contain at least 32 characters')
    busy = threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def reply(self, status, value):
            data=json.dumps(value,ensure_ascii=False).encode('utf-8')
            self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def authorized(self):
            return hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+token).encode())
        def do_GET(self):
            if not self.authorized(): return self.reply(401,{'error':'Unauthorized'})
            if self.path!='/health': return self.reply(404,{'error':'Not found'})
            tts={'enabled':synthesizer is not None,'engine':'windows-local','device':'cpu','sample_rate':17000}
            if hasattr(synthesizer,'metadata'): tts.update(synthesizer.metadata())
            self.reply(200,{'ready':True,'device':device,'model':model_name,'tts':tts})
        def do_POST(self):
            if not self.authorized(): return self.reply(401,{'error':'Unauthorized'})
            if self.path=='/synthesize':
                if synthesizer is None: return self.reply(503,{'error':'Synthesis unavailable'})
                if self.headers.get('Content-Type')!='application/json': return self.reply(415,{'error':'JSON required'})
                if not busy.acquire(False): return self.reply(429,{'error':'Busy'})
                try:
                    self.connection.settimeout(10)
                    size=int(self.headers.get('Content-Length','0'))
                    if not 0<size<=4096: return self.reply(400,{'error':'Invalid request size'})
                    data=self.rfile.read(size)
                    if len(data)!=size: return self.reply(400,{'error':'Incomplete request'})
                    value=json.loads(data)
                    text=value.get('text') if isinstance(value,dict) else None
                    if not isinstance(text,str) or not text.strip() or len(text)>200: return self.reply(400,{'error':'Text must contain 1-200 characters'})
                    pcm=synthesizer(text)
                    if not isinstance(pcm,bytes) or not pcm or len(pcm)%2 or len(pcm)>4194304: raise RuntimeError('Invalid synthesis output')
                    self.send_response(200)
                    self.send_header('Content-Type','application/octet-stream')
                    self.send_header('Cache-Control','no-store')
                    self.send_header('Content-Length',str(len(pcm)))
                    self.send_header('X-Audio-Sample-Rate','17000')
                    self.send_header('X-Audio-Channels','1')
                    self.send_header('X-Audio-Bits','16')
                    self.end_headers();self.wfile.write(pcm)
                except OverflowError: self.reply(422,{'error':'Audio exceeds memory budget'})
                except (ValueError,UnicodeError): self.reply(400,{'error':'Invalid synthesis request'})
                except Exception: self.reply(500,{'error':'Local synthesis failed'})
                finally: busy.release()
                return
            if self.path!='/transcribe': return self.reply(404,{'error':'Not found'})
            if self.headers.get('Content-Type')!='audio/wav': return self.reply(415,{'error':'WAV required'})
            if not busy.acquire(False): return self.reply(429,{'error':'Busy'})
            try:
                self.connection.settimeout(10)
                size=int(self.headers.get('Content-Length','0'))
                if size!=170044: return self.reply(400,{'error':'Five-second mono WAV required'})
                data=self.rfile.read(size)
                if len(data)!=size: return self.reply(400,{'error':'Incomplete audio'})
                with wave.open(io.BytesIO(data),'rb') as wav:
                    if (wav.getnchannels(),wav.getsampwidth(),wav.getframerate(),wav.getnframes())!=(1,2,17000,85000): return self.reply(400,{'error':'Invalid WAV format'})
                segments,_=model.transcribe(io.BytesIO(data),language='zh',beam_size=5,vad_filter=True,condition_on_previous_text=False,initial_prompt='以下是繁體中文的日常對話。')
                text=''.join(s.text for s in segments if getattr(s,'no_speech_prob',0)<0.6 and getattr(s,'avg_logprob',0)>-1.0).strip()
                self.reply(200,{'text':text[:2000]})
            except (ValueError,wave.Error): self.reply(400,{'error':'Invalid audio'})
            except Exception: self.reply(500,{'error':'Transcription failed; check local GPU/runtime setup'})
            finally: busy.release()
    return ThreadingHTTPServer((host,port),Handler)

if __name__=='__main__':
    from faster_whisper import WhisperModel
    from synthesis import synthesize
    token=os.environ.get('STT_TOKEN','')
    if len(token)<32: raise SystemExit('Set a 32+ character STT_TOKEN before starting.')
    device=os.environ.get('STT_DEVICE','cuda');name=os.environ.get('STT_MODEL','small')
    model=WhisperModel(name,device=device,compute_type='float16' if device=='cuda' else 'int8')
    if os.environ.get('TTS_ENGINE','windows')=='character':
        from character import CharacterSynthesizer
        synthesizer=CharacterSynthesizer(lambda text:synthesize(text,timeout=8))
        try: synthesizer.start()
        except Exception: print('Character TTS unavailable; Windows fallback active.',flush=True)
    else: synthesizer=synthesize
    server=create_server(model,token,os.environ.get('STT_HOST','127.0.0.1'),int(os.environ.get('STT_PORT','8001')),device,name,synthesizer)
    print('Speech service ready. Audio and transcripts are not logged.',flush=True)
    try: server.serve_forever()
    finally:
        server.server_close()
        if hasattr(synthesizer,'shutdown'): synthesizer.shutdown()
        elif hasattr(synthesizer,'close'): synthesizer.close()
