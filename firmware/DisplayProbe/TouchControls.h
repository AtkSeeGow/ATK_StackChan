#pragma once

namespace touch_controls {
static bool open=false,changed=true,held=false,swallow=false,pending=false;
static bool lastConnected=false;
static uint32_t sentAt=0,confirmUntil=0;
static char pendingId[9]="";
static const char* notice="";
inline void send(const char* action){
  if(!realtimeConnected||!touchCommands||!touchReplies){notice="連線中，請稍候";changed=true;return;}
  NetworkAck command{};
  snprintf(pendingId,sizeof(pendingId),"%08lx",(unsigned long)esp_random());
  const char* phaseName=phase=='f'?"focus":"break";
  const char* stateName=status=='r'?"running":status=='p'?"paused":status=='c'?"completed":"idle";
  snprintf(command.text,sizeof(command.text),"{\"type\":\"timer_control\",\"id\":\"%s\",\"session\":\"%s\",\"phase\":\"%s\",\"status\":\"%s\",\"action\":\"%s\"}",pendingId,currentSession,phaseName,stateName,action);
  if(xQueueSend(touchCommands,&command,0)!=pdTRUE){notice="忙碌中，請稍候";changed=true;return;}
  pending=true;sentAt=millis();notice="處理中…";changed=true;
}
inline void service(bool wasSleeping){
  bool connected=realtimeConnected;if(connected!=lastConnected){lastConnected=connected;changed=true;}
  NetworkAck reply{};
  if(touchReplies&&xQueueReceive(touchReplies,&reply,0)==pdTRUE){
    char id[9]="",result[16]="";
    if(sscanf(reply.text,"C|%8[0-9a-f]|%15[a-z]",id,result)==2&&pending&&!strcmp(id,pendingId)){
      pending=false;notice=!strcmp(result,"ok")?"已送出":!strcmp(result,"stale")?"狀態已更新，請再操作":"目前無法操作，請查看網頁";changed=true;
      if(!strcmp(result,"ok"))open=false;
    }
  }
  if(pending&&millis()-sentAt>5000){pending=false;notice="未確認結果，請查看網頁";changed=true;}
  if(confirmUntil&&int32_t(millis()-confirmUntil)>=0){confirmUntil=0;changed=true;}
  bool down=!cameraBusReleased&&screen_idle::touchPoints>0&&screen_idle::touchPoints<=5&&millis()-screen_idle::lastTouchPoll<150;
  if(wasSleeping){swallow=true;held=down;return;}
  if(!down){held=false;swallow=false;return;}
  if(held||swallow||screen_idle::sleeping)return;
  held=true;
  int x=screen_idle::touchX,y=screen_idle::touchY;
  Serial.printf("{\"type\":\"touch_press\",\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d,\"menu_open\":%s}\n",x,y,M5.Display.width(),M5.Display.height(),open?"true":"false");
  // Opening the menu is harmless; accept the whole expression screen rather
  // than requiring a precise tap on the small label at the lower edge.
  if(!open){open=true;notice="";changed=true;return;}
  if(x<0||x>=320||y<0||y>=240)return;
  if(x>=264&&y<55){open=false;changed=true;return;}
  if(pending)return;
  if(y>=78&&y<134){
    if(x<160){confirmUntil=0;send(status=='r'?"pause":status=='p'?"resume":status=='c'?"nextStart":"start");}
    else if(confirmUntil){confirmUntil=0;send("reset");}
    else {confirmUntil=millis()+3000;changed=true;}
  }else if(y>=146&&y<202){
    if(x<160){if(status=='i')send("switch");}
    else {open=false;changed=true;}
  }
}
inline void button(int x,int y,const char* label,bool enabled=true){
  frame.fillRoundRect(x,y,144,54,10,enabled?0x326b:0x2104);
  frame.setTextColor(enabled?0xffff:0x8410);
  frame.drawCenterString(label,x+72,y+16);
}
inline void draw(){
  frame.setFont(&fonts::efontTW_16);frame.setTextSize(1);
  if(open){
    frame.fillScreen(0x1947);frame.setTextColor(0xffff);
    frame.drawString("番茄鐘操作",12,12);frame.drawString("關閉",270,12);
    frame.drawString(phase=='f'?"專注":"休息",12,43);
    frame.drawString(status=='r'?"計時中":status=='p'?"已暫停":status=='c'?"已完成":"準備開始",80,43);
    button(8,78,status=='r'?"暫停":status=='p'?"繼續":status=='c'?(phase=='f'?"開始休息":"開始專注"):"開始",!pending&&realtimeConnected);
    button(168,78,confirmUntil?"確認重設":"重設",!pending&&realtimeConnected);
    button(8,146,phase=='f'?"改為休息":"改為專注",status=='i'&&!pending&&realtimeConnected);
    button(168,146,"返回表情");
    frame.setTextColor(0xefb5);frame.drawCenterString(realtimeConnected?notice:"連線中，暫時無法操作",160,216);
  }
  frame.setFont(nullptr);frame.setTextSize(1);changed=false;
}
}
