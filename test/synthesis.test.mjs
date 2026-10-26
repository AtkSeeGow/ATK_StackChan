import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {SynthesisPlayback} from '../synthesis.mjs';

test('synthesis bounds PCM, prevents replay and releases expired/private audio',async()=>{
  let now=100000,mode='normal',calls=0;
  const token='t'.repeat(64);
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,`Bearer ${token}`);assert.equal(req.url,'/synthesize');
    let raw='';for await(const chunk of req)raw+=chunk;
    assert.equal(JSON.parse(raw).text,'測試');calls++;
    res.setHeader('X-Audio-Sample-Rate',mode==='format'?'44100':'17000');res.setHeader('X-Audio-Channels','1');res.setHeader('X-Audio-Bits','16');
    const pcm=Buffer.alloc(mode==='oversize'?1020002:34000);
    for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(30000,i);
    res.end(pcm);
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const s=new SynthesisPlayback(`http://127.0.0.1:${server.address().port}`,token,()=>now);
    await assert.rejects(s.start('12345678','',208,8));assert.equal(calls,0);
    const prepared=await s.prepare('測試',8);
    assert.equal(s.job.status,'idle');assert.equal(s.pcm,null);assert.ok(prepared.length>0);
    s.enqueuePrepared('prepared1',prepared);
    assert.equal(s.snapshot().status,'queued');assert.equal(s.take('prepared1'),prepared);
    s.report({id:'prepared1',status:'completed'});
    await s.start('12345678','測試',208,8);
    assert.equal(s.snapshot().status,'queued');assert.equal(s.snapshot().text,undefined);
    await assert.rejects(s.start('87654321','測試',208,8));
    assert.throws(()=>s.take('wrong'));
    const pcm=s.take('12345678');assert.equal(pcm.readInt16LE(1000),14000);assert.equal(pcm.readInt16LE(0),0);
    assert.equal(s.pcm,null);assert.throws(()=>s.take('12345678'));
    assert.equal(s.report({id:'wrong',status:'completed'}),false);
    assert.equal(s.report({id:'12345678',status:'playback'}),true);
    assert.equal(s.report({id:'12345678',status:'completed'}),true);
    assert.equal(s.report({id:'12345678',status:'completed'}),false);
    assert.equal(s.snapshot().status,'completed');
    await s.start('00000002','測試',208,8);now+=15001;
    assert.equal(s.snapshot().status,'timeout');assert.equal(s.pcm,null);assert.throws(()=>s.take('00000002'));
    mode='format';await s.start('00000003','測試',208,8);assert.equal(s.snapshot().status,'failed');assert.equal(s.pcm,null);
    mode='oversize';await s.start('00000004','測試',208,8);assert.equal(s.snapshot().status,'failed');assert.equal(s.pcm,null);
  }finally{await new Promise(r=>server.close(r));}
});
