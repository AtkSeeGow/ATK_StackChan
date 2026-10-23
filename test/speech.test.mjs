import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {SpeechService,pcmWave} from '../speech.mjs';
test('speech uses bounded WAV, authenticates service and keeps text for confirmation',async()=>{
 const token='t'.repeat(64);let fail=false,calls=0;
 const server=http.createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,`Bearer ${token}`);
  res.setHeader('Content-Type','application/json');
  if(req.url==='/health')return res.end(JSON.stringify({ready:true,device:'test',model:'mock'}));
  let length=0;for await(const chunk of req)length+=chunk.length;
  assert.equal(length,170044);assert.equal(req.headers['content-type'],'audio/wav');calls++;
  if(fail)res.writeHead(500);
  res.end(JSON.stringify({text:'你好，測試語音。'}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const s=new SpeechService(`http://127.0.0.1:${server.address().port}`,token);
  assert.equal((await s.health()).connected,true);
  const pcm=Buffer.alloc(170000),wav=pcmWave(pcm);
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),17000);
  assert.throws(()=>pcmWave(Buffer.alloc(3)));
  s.start('12345678');assert.throws(()=>s.start('87654321'));
  await s.accept('12345678',pcm);assert.equal(s.snapshot().text,'你好，測試語音。');assert.equal(s.snapshot().status,'completed');
  await assert.rejects(s.accept('12345678',pcm));assert.equal(calls,1);
  fail=true;s.start('87654321');await s.accept('87654321',pcm);assert.equal(s.snapshot().status,'failed');
  s.reset();s.start('00000001');s.job.requestedAt-=31000;assert.equal(s.snapshot().status,'timeout');await assert.rejects(s.accept('00000001',pcm));
 }finally{await new Promise(r=>server.close(r));}
});
