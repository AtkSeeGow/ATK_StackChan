#pragma once
#include "ScreenIdleClock.h"

namespace screen_idle {
static ScreenIdleClock clock;
static bool sleeping=false;
static bool redrawOnWake=false;
static bool touchReady=false;
static uint8_t touchPoints=0;
static int touchX=-1,touchY=-1;
static uint32_t lastTouchPoll=0;
static uint32_t touchSamples=0,touchDetections=0;
static uint32_t maxPollGap=0,wakeAt=0;
static const char* pendingWake="unknown";
inline bool pollTouch(){
  if(cameraBusReleased||body_motion::busy){touchReady=false;touchPoints=0;return false;}
  motor_safety::HardwareGuard guard;
  uint8_t data[5]={};
  touchReady=M5.In_I2C.readRegister(0x38,0x02,data,sizeof(data),100000);
  touchPoints=touchReady?(data[0]&0x0f):0;
  if(touchPoints>0&&touchPoints<=5){touchX=((data[1]&15)<<8)|data[2];touchY=((data[3]&15)<<8)|data[4];M5.Display.convertRawXY(&touchX,&touchY);}
  ++touchSamples;
  if(touchPoints>0&&touchPoints<=5)++touchDetections;
  return touchPoints>0&&touchPoints<=5;
}
inline void begin(){clock.begin(millis());}
inline void activity(const char* id){bool wasAsleep=clock.sleeping;clock.activity(id,millis());if(wasAsleep&&!clock.sleeping)pendingWake="web_activity";}
inline void service(char timerStatus){
  bool touched=M5.Touch.getCount()>0,rawTouch=false;
  if(millis()-lastTouchPoll>=50){uint32_t gap=millis()-lastTouchPoll;if(sleeping&&gap>maxPollGap)maxPollGap=gap;lastTouchPoll=millis();rawTouch=pollTouch();touched=rawTouch||touched;}
  bool next=clock.update(millis(),timerStatus=='r'||audioStage||body_motion::busy,touched);
  if(next==sleeping)return;
  motor_safety::HardwareGuard guard;
  sleeping=next;
  uint32_t transitionAt=millis();
  if(!sleeping){redrawOnWake=true;wakeAt=transitionAt;}
  else maxPollGap=0;
  if(sleeping){
    // Reclaim the camera-shared bus so capacitive touch can wake the screen.
    cameraControl("C|0");
    if(cameraBusReleased){M5.In_I2C.begin();cameraBusReleased=false;}
    // Preserve the working touch mode; only switch the backlight rail off.
    M5.Display.fillScreen(0);
  }
  M5.Display.setBrightness(sleeping?0:90);
  Serial.printf("{\"type\":\"display_transition\",\"sleeping\":%s,\"cause\":\"%s\",\"brightness_ms\":%lu,\"max_poll_gap_ms\":%lu}\n",sleeping?"true":"false",sleeping?"idle":touched?(rawTouch?"raw_touch":"m5_touch"):(timerStatus=='r'||audioStage||body_motion::busy)?"in_use":pendingWake,(unsigned long)(millis()-transitionAt),(unsigned long)maxPollGap);
  pendingWake="unknown";
  Serial.printf("{\"type\":\"display_state\",\"sleeping\":%s,\"idle_timeout_seconds\":1800}\n",sleeping?"true":"false");
}
inline bool command(const String& value){
  if(value=="D|sleep"){clock.expireForTest(millis());return true;}
  if(value=="D|wake"){pendingWake="usb";clock.update(millis(),false,true);return true;}
  if(value=="D|status"){
    pollTouch();
    uint8_t chip=0,vendor=0,mode=0,ioId=0,pmicId=0;
    {motor_safety::HardwareGuard guard;
      M5.In_I2C.readRegister(0x38,0xa3,&chip,1,100000);
      M5.In_I2C.readRegister(0x38,0xa8,&vendor,1,100000);
      M5.In_I2C.readRegister(0x38,0xa5,&mode,1,100000);
      M5.In_I2C.readRegister(0x58,0x10,&ioId,1,100000);
      M5.In_I2C.readRegister(0x34,0x03,&pmicId,1,100000);
    }
    Serial.printf("{\"type\":\"touch_bus\",\"camera_released\":%s,\"io_id\":%u,\"pmic_id\":%u,\"sda\":%d,\"scl\":%d}\n",cameraBusReleased?"true":"false",ioId,pmicId,digitalRead(12),digitalRead(11));
    Serial.printf("{\"type\":\"touch_diagnostic\",\"chip\":%u,\"vendor\":%u,\"power_mode\":%u,\"samples\":%lu,\"detections\":%lu,\"last_x\":%d,\"last_y\":%d}\n",chip,vendor,mode,(unsigned long)touchSamples,(unsigned long)touchDetections,touchX,touchY);
    Serial.printf("{\"type\":\"display_state\",\"sleeping\":%s,\"idle_timeout_seconds\":1800,\"touch_enabled\":%s,\"touch_controller_ready\":%s,\"touch_points\":%u}\n",sleeping?"true":"false",M5.Touch.isEnabled()?"true":"false",touchReady?"true":"false",touchPoints);return true;
  }
  if(value=="D|touch-active"){
    motor_safety::HardwareGuard guard;
    if(!cameraBusReleased&&!body_motion::busy){
      M5.In_I2C.writeRegister8(0x38,0x00,0,100000);
      M5.In_I2C.writeRegister8(0x38,0xa4,0,100000);
      M5.In_I2C.writeRegister8(0x38,0xa5,0,100000);
    }
    return true;
  }
  if(value=="D|touch-reinit"){
    motor_safety::HardwareGuard guard;
    if(!cameraBusReleased&&!body_motion::busy){
      M5.In_I2C.release();
      bool bus=M5.In_I2C.begin(I2C_NUM_1,12,11);
      bool touch=M5.Display.touch()&&M5.Display.touch()->init();
      Serial.printf("{\"type\":\"touch_reinit\",\"bus\":%s,\"touch\":%s}\n",bus?"true":"false",touch?"true":"false");
    }
    return true;
  }
  return false;
}
}
