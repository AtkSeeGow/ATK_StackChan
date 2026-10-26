import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {attachRealtime} from '../realtime.mjs';

test('WebSocket pushes browser state and device frames; only device may acknowledge',async()=>{
  const server=http.createServer();const received=[];
  const hub=attachRealtime(server,{
    authorize:req=>req.url==='/browser'?'browser':req.headers.authorization==='Bearer test'?'device':null,
    getState:()=>({timer:{phase:'focus'},settings:{}}),getFrame:()=> 'S|12345678|1|60|f|r|n|u|3|00000000|n\nB|-7|15|00000000|s|15',onDeviceMessage:message=>received.push(message)
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`ws://127.0.0.1:${server.address().port}`;
  const browser=new WebSocket(url+'/browser');const device=new WebSocket(url+'/device',{headers:{Authorization:'Bearer test'}});
  try{
    const [browserMessage,deviceMessage]=await Promise.all([once(browser,'message'),once(device,'message')]);
    assert.equal(JSON.parse(browserMessage[0]).timer.phase,'focus');assert.match(deviceMessage[0].toString(),/B\|-7\|15/);
    browser.send('{"type":"forged"}');device.send('{"type":"sync_ack"}');
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.deepEqual(received,[{type:'sync_ack'}]);assert.equal(hub.snapshot().device,1);
    const bad=new WebSocket(url+'/device');await assert.rejects(once(bad,'open'),/403/);
  }finally{browser.terminate();device.terminate();await new Promise(resolve=>server.close(resolve));}
});
