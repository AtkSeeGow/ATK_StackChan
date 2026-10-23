// Tests the private synthesis endpoint with a fixed sentence; never saves audio.
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const url=process.env.STACKCHAN_STT_URL?.replace(/\/$/,'');
const token=process.env.STACKCHAN_STT_TOKEN || '';
if (!url || token.length<32) throw new Error('請先設定現有語音服務網址與金鑰。');
const response=await fetch(url+'/synthesize',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
  headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({text:'你好，現在開始專注時間。'}),
});
if (!response.ok) throw new Error(`合成服務回傳 HTTP ${response.status}`);
if(response.headers.get('x-audio-sample-rate')!=='17000' || response.headers.get('x-audio-channels')!=='1' || response.headers.get('x-audio-bits')!=='16') throw new Error('音訊格式不相符。');
const chunks=[];let size=0;
for await(const chunk of response.body){size+=chunk.length;if(size>1020000)throw new Error('合成音訊超過三十秒。');chunks.push(chunk);}
const pcm=Buffer.concat(chunks);
if(!pcm.length || pcm.length%2) throw new Error('音訊資料不完整。');
let peak=0;for(let i=0;i<pcm.length;i+=2)peak=Math.max(peak,Math.abs(pcm.readInt16LE(i)));
if(!peak) throw new Error('合成音訊全為靜音。');
console.log(JSON.stringify({connected:true,rate:17000,channels:1,bits:16,seconds:Number((pcm.length/34000).toFixed(3)),peak,audioSaved:false}));
