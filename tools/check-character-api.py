"""Fixed synthetic API checks; audio/text remain in RAM, credentials never printed."""
import io
import json
from pathlib import Path
import time
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]

def main():
    settings=json.loads((ROOT/'services/speech/settings.local.json').read_text(encoding='utf-8-sig'))
    base=f"http://{settings['host']}:{settings['port']}"
    authorization='Bearer '+settings['token']
    def health():
        with urllib.request.urlopen(urllib.request.Request(base+'/health',headers={'Authorization':authorization}),timeout=3) as response:
            return json.load(response)
    deadline=time.monotonic()+180
    while True:
        try:
            before=health()
            break
        except Exception:
            if time.monotonic()>deadline:raise RuntimeError('Service did not become ready') from None
            time.sleep(2)
    if before['device']!='cuda' or before['tts'].get('engine')!='qwen3-local' or not before['tts'].get('ready'):
        raise RuntimeError('CUDA character service is not ready')
    print(json.dumps({'health':before}),flush=True)
    texts=[
        '哼，雜魚，總算肯開始了？那就先專心五分鐘吧。欸，這一段做完了耶。還不錯嘛，稍微誇你一下。累了就休息一下啦。我又沒有要催你……真的。',
        '今天已經很努力了，先喝口水，讓眼睛休息一下吧。剩下的慢慢來，我會陪著你。',
    ]
    results=[]
    for index,text in enumerate(texts):
        started=time.perf_counter()
        request=urllib.request.Request(base+'/synthesize',data=json.dumps({'text':text}).encode(),
            headers={'Authorization':authorization,'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=49) as response:
            assert [response.headers.get(h) for h in ('X-Audio-Sample-Rate','X-Audio-Channels','X-Audio-Bits')]==['17000','1','16']
            assert response.headers.get_content_type()=='application/octet-stream'
            pcm=response.read(1020001)
        elapsed=time.perf_counter()-started
        assert pcm and len(pcm)%2==0 and len(pcm)<=1020000
        import array
        samples=array.array('h');samples.frombytes(pcm)
        peak=max(abs(v) for v in samples)
        assert peak>0
        after=health()
        assert after['tts']['last_engine']=='qwen3-local' and after['tts']['fallback_count']==before['tts']['fallback_count']
        result=dict(case=index+1,seconds=len(pcm)/34000,elapsed=elapsed,peak=peak,engine=after['tts']['last_engine'])
        results.append(result)
        print(json.dumps(result),flush=True)
        if index==0:
            # Real GPU STT on synthesized speech, without microphone or disk audio.
            stream=io.BytesIO()
            with wave.open(stream,'wb') as wav:
                wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(17000)
                wav.writeframes((pcm+bytes(170000))[:170000])
            started=time.perf_counter()
            request=urllib.request.Request(base+'/transcribe',data=stream.getvalue(),
                headers={'Authorization':authorization,'Content-Type':'audio/wav'})
            with urllib.request.urlopen(request,timeout=120) as response: recognized=json.load(response)
            assert isinstance(recognized.get('text'),str) and recognized['text'].strip()
            print(json.dumps({'synthetic_stt':True,'text_characters':len(recognized['text']),'elapsed':time.perf_counter()-started}),flush=True)
    (ROOT/'.tools/voice-design/api-validation.json').write_text(json.dumps({'health':health(),'cases':results},indent=2),encoding='utf-8')

if __name__=='__main__':main()
