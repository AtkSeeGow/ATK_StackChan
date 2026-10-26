import {WebSocketServer,WebSocket} from 'ws';

export function attachRealtime(server,{authorize,getState,getFrame,onDeviceMessage}){
  const hub=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    let kind;
    try{kind=authorize(req);}catch{}
    if(!kind){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    hub.handleUpgrade(req,socket,head,ws=>{
      ws.kind=kind;ws.alive=true;
      ws.on('error',()=>{});
      ws.on('pong',()=>{ws.alive=true;});
      ws.on('message',data=>{
        if(kind!=='device')return;
        try{const reply=onDeviceMessage(JSON.parse(data.toString()));if(typeof reply==='string')ws.send(reply);}catch{}
      });
      hub.emit('connection',ws,req);
    });
  });
  const push=()=>{
    let stateText;
    for(const ws of hub.clients){
      if(ws.readyState!==WebSocket.OPEN)continue;
      if(ws.bufferedAmount>65536){ws.terminate();continue;}
      try{ws.send(ws.kind==='device'?getFrame():(stateText??=JSON.stringify(getState())));}catch{ws.terminate();}
    }
  };
  hub.on('connection',push);
  const ticker=setInterval(push,500);ticker.unref();
  const heartbeat=setInterval(()=>{
    for(const ws of hub.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}
  },10000);heartbeat.unref();
  server.on('close',()=>{clearInterval(ticker);clearInterval(heartbeat);for(const ws of hub.clients)ws.terminate();hub.close();});
  return {push,snapshot:()=>({browser:[...hub.clients].filter(ws=>ws.kind==='browser').length,device:[...hub.clients].filter(ws=>ws.kind==='device').length})};
}
