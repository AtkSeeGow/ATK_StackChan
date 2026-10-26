#pragma once

namespace body_motion {
struct Command { NetworkFrame frame; char serial[80]; int gestureDegrees; int center; };
static QueueHandle_t commands=nullptr;
static std::atomic<bool> busy{false};
static char lastScheduledId[9]="";
inline void task(void*){
  Command command{};
  for(;;){
    if(xQueueReceive(commands,&command,portMAX_DELAY)!=pdTRUE)continue;
    if(command.serial[0])motor_safety::handleCommand(String(command.serial));
    else if(command.gestureDegrees){
      motor_safety::centerOffsetDegrees=command.center;
      motor_safety::supervisedYawSweep(command.gestureDegrees,true);
    }else{
      const auto& f=command.frame;
      motor_safety::networkSweep(f.motorId,f.motorDegrees,f.motorCenterMode,f.motorCenterOffset);
    }
    busy=false;
  }
}
inline void begin(){
  motor_safety::initializeHardwareLock();
  if(!motor_safety::hardwareMutex)return;
  commands=xQueueCreate(1,sizeof(Command));
  if(commands&&xTaskCreate(task,"stackchan-motion",6144,nullptr,1,nullptr)!=pdPASS){vQueueDelete(commands);commands=nullptr;}
}
inline bool enqueue(Command command){
  if(!commands||audioStage||cameraBusReleased)return false;
  bool expected=false;if(!busy.compare_exchange_strong(expected,true))return false;
  if(xQueueSend(commands,&command,0)!=pdTRUE){busy=false;return false;}
  return true;
}
inline void sync(const NetworkFrame& frame){
  if(!frame.motorId[0]){if(!busy&&abs(frame.motorCenterOffset)<=15)motor_safety::centerOffsetDegrees=frame.motorCenterOffset;return;}
  if(!strcmp(frame.motorId,lastScheduledId))return;
  Command command{};command.frame=frame;
  if(enqueue(command))strcpy(lastScheduledId,frame.motorId);
}
inline bool gesture(int degrees){
  Command command{};command.gestureDegrees=degrees;command.center=motor_safety::centerOffsetDegrees;
  return enqueue(command);
}
inline void serial(const String& text){
  Command command{};text.toCharArray(command.serial,sizeof(command.serial));
  if(!enqueue(command))motor_safety::reportFailure("command","motion_worker_busy");
}
}
