#pragma once
#include <stdint.h>

class ScreenIdleClock {
 public:
  static constexpr uint32_t timeoutMs=30UL*60UL*1000UL;
  constexpr void begin(uint32_t now){lastActivity=now;sleeping=false;lastId[0]=0;}
  constexpr void activity(const char* id,uint32_t now){
    bool changed=false;
    for(int index=0;index<8;++index){
      char c=id[index];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return;
      if(c!=lastId[index])changed=true;
    }
    if(id[8]||!changed)return;
    for(int index=0;index<9;++index)lastId[index]=id[index];
    lastActivity=now;sleeping=false;
  }
  constexpr bool update(uint32_t now,bool inUse,bool touched){
    if(inUse||touched){lastActivity=now;sleeping=false;}
    else if(now-lastActivity>=timeoutMs)sleeping=true;
    return sleeping;
  }
  constexpr void expireForTest(uint32_t now){lastActivity=now-timeoutMs;}
  bool sleeping=false;
 private:
  uint32_t lastActivity=0;
  char lastId[9]="";
};

// Exercise the same state machine at compile time, including millis() wrap.
constexpr bool screenIdleClockChecks(){
  ScreenIdleClock clock;clock.begin(100);
  if(clock.update(100+ScreenIdleClock::timeoutMs-1,false,false))return false;
  if(!clock.update(100+ScreenIdleClock::timeoutMs,false,false))return false;
  if(clock.update(100+ScreenIdleClock::timeoutMs+1,false,true))return false;
  clock.activity("12345678",2000000);
  clock.activity("12345678",2000000+ScreenIdleClock::timeoutMs);
  if(!clock.update(2000000+ScreenIdleClock::timeoutMs,false,false))return false;
  clock.activity("87654321",4000000);if(clock.sleeping)return false;
  if(clock.update(6000000,true,false)||clock.update(6000001,false,false))return false;
  clock.begin(0xfffffff0u);if(clock.update(10,false,false))return false;
  return clock.update(uint32_t(0xfffffff0u+ScreenIdleClock::timeoutMs),false,false);
}
static_assert(screenIdleClockChecks(),"screen idle timeout/touch/activity policy failed");
