#pragma once
#include <stdint.h>

namespace face_animation {
constexpr int ease(int from,int to,uint32_t time,uint32_t duration){
  if(time>=duration)return to;
  int32_t t=int32_t(time*1024/duration);
  int32_t weight=t*t/1024*(3072-2*t)/1024;
  return from+(to-from)*weight/1024;
}
constexpr int gaze(uint32_t now){
  uint32_t t=now%12000;
  if(t<3000)return 0;
  if(t<3400)return ease(0,-15,t-3000,400);
  if(t<4300)return -15;
  if(t<4700)return ease(-15,0,t-4300,400);
  if(t<7600)return 0;
  if(t<8000)return ease(0,15,t-7600,400);
  if(t<8900)return 15;
  if(t<9300)return ease(15,0,t-8900,400);
  return 0;
}
constexpr int blinkHeight(uint32_t now,int height){
  uint32_t t=now%11000;
  if(t>=1800&&t<2080)t-=1800;
  else if(t>=7300&&t<7580)t-=7300;
  else return height;
  if(t<80)return ease(height,3,t,80);
  if(t<130)return 3;
  return ease(3,height,t-130,150);
}
struct Pose {
  int gaze=0,bob=0,eyes=30,mouth=0,pulse=0;
  bool happyEyes=false;
  uint32_t key()const{return uint32_t(gaze+16)|(uint32_t(bob+8)<<6)|(uint32_t(eyes)<<10)|(uint32_t(mouth)<<16)|(uint32_t(pulse)<<18)|(uint32_t(happyEyes)<<21);}
};
inline Pose pose(char expression,uint32_t now,bool speaking,bool listening,bool cue,int mouth){
  Pose p;
  p.gaze=(!speaking&&!listening&&!cue&&(expression=='n'||expression=='t'))?gaze(now):0;
  uint32_t breath=now%4800;
  p.bob=breath<2400?ease(0,-2,breath,2400):ease(-2,0,breath-2400,2400);
  if(expression=='h'&&!speaking&&!listening&&!cue){
    uint32_t t=now%6500;
    p.bob=t<250?ease(0,-6,t,250):t<600?ease(-6,0,t-250,350):0;
    p.happyEyes=true;
  }
  p.eyes=blinkHeight(now,expression=='t'?19:30);
  p.mouth=mouth;
  p.pulse=(listening||cue)?(now/100)%8:0;
  return p;
}
static_assert(gaze(3000)==0&&gaze(3400)==-15&&gaze(4700)==0&&gaze(8000)==15&&gaze(9300)==0,"gaze endpoints");
static_assert(blinkHeight(1800,30)==30&&blinkHeight(1880,30)==3&&blinkHeight(2080,30)==30,"blink endpoints");
}
