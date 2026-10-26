#include <M5Unified.h>
#include "FaceAnimation.h"
#include "NetworkTransport.h"
#include "CameraTransport.h"
#include "AudioProbe.h"
#include "MotorSafety.h"
#include "BodyMotionTask.h"
#include "TimerEffects.h"
#include "ScreenIdle.h"

// Protocol v2 adds feature flags and an idempotent, short-lived body cue.
// S|session|seq|seconds|phase|status|expression|presence|flags|cue-id|cue-code\n
String input;
bool overflow = false, hasState = false;
String serialInput;
bool serialOverflow = false;
uint32_t receivedAt = 0, remaining = 0, lastDraw = 0;
char currentSession[9] = "", phase = 'f', status = 'i', expression = 'n', presence = 'u';
unsigned long lastSeq = 0;
M5Canvas frame(&M5.Display);
uint32_t renderCount = 0;
const char* expressionName() {
  switch (expression) { case 'h': return "happy"; case 't': return "teasing"; case 'c': return "concerned"; default: return "neutral"; }
}
const char* statusName() {
  switch (status) { case 'r': return "running"; case 'p': return "paused"; case 'c': return "completed"; default: return "idle"; }
}
uint8_t speakingMouthFrame() {
  if (audioStage != 3 || audioSamples == nullptr || audioLength == 0) return 0;
  size_t position = min(audioLength - 1, (size_t)((millis() - audioAt) * audioRate / 1000));
  size_t end = min(audioLength, position + 96);
  int peak = 0;
  for (size_t i = position; i < end; i += 4) peak = max(peak, abs((int)audioSamples[i]));
  if (peak < 350) return 0;
  if (peak < 1800) return 1;
  if (peak < 5500) return 2;
  return 3;
}
void drawExpressionFace(const face_animation::Pose& pose,bool speaking,bool listening,bool cue) {
  constexpr uint16_t outline=0x7CE7,face=0x2A49,ink=0xEFB5,accent=0xAEB8;
  const int y=32+pose.bob,eyeY=y+49;
  if(listening){
    int radius=12+pose.pulse*3;
    frame.drawCircle(30,y+56,radius,accent);frame.drawCircle(290,y+56,radius,accent);
    if(radius>22){frame.drawCircle(30,y+56,radius-9,accent);frame.drawCircle(290,y+56,radius-9,accent);}
  }
  frame.fillRoundRect(30,y,260,112,22,outline);
  frame.fillRoundRect(35,y+5,250,102,18,face);
  for(int center : {100,220}){
    center+=pose.gaze;
    if(pose.happyEyes&&pose.eyes>12){
      for(int offset=-1;offset<=1;++offset){
        frame.drawLine(center-13,eyeY+2+offset,center,eyeY-7+offset,ink);
        frame.drawLine(center,eyeY-7+offset,center+13,eyeY+2+offset,ink);
      }
    }else{
      frame.fillRoundRect(center-11,eyeY-pose.eyes/2,22,pose.eyes,min(8,pose.eyes/2),ink);
    }
  }
  if(expression=='h'||expression=='t'){
    frame.fillRoundRect(66+pose.gaze,y+70,24,5,2,accent);
    frame.fillRoundRect(230+pose.gaze,y+70,24,5,2,accent);
  }
  if(expression=='c'){
    for(int offset=0;offset<2;++offset){
      frame.drawLine(83,y+26+offset,112,y+18+offset,ink);
      frame.drawLine(208,y+18+offset,237,y+26+offset,ink);
    }
  }
  int mx=160+pose.gaze/3,my=y+82;
  if(speaking){
    const int widths[]={24,14,23,32},heights[]={4,10,18,25};
    int w=widths[pose.mouth],h=heights[pose.mouth];
    frame.fillRoundRect(mx-w/2,my-h/2,w,h,min(8,h/2),ink);
    if(pose.mouth>=2)frame.fillRoundRect(mx-w/2+4,my-h/2+4,w-8,h-8,3,face);
  }else if(expression=='h'){
    frame.fillRoundRect(mx-17,my-6,34,23,10,ink);
    frame.fillRect(mx-19,my-8,38,10,face);
  }else if(expression=='t'){
    for(int offset=0;offset<3;++offset){
      frame.drawLine(mx-17,my+5+offset,mx+2,my+5+offset,ink);
      frame.drawLine(mx+2,my+5+offset,mx+19,my-3+offset,ink);
    }
  }else if(expression=='c'){
    for(int offset=0;offset<3;++offset){
      frame.drawLine(mx-13,my+5+offset,mx,my+offset,ink);
      frame.drawLine(mx,my+offset,mx+13,my+5+offset,ink);
    }
  }else{
    frame.fillRoundRect(mx-12,my+2,24,4,2,ink);
  }
  if(cue)frame.fillCircle(160,y+101,2+pose.pulse/2,accent);
}
bool applyFrame() {
  char session[9], nextPhase, nextStatus, nextExpression, nextPresence, cueId[9], cueCode, extra;
  unsigned long seq, seconds; unsigned int effectFlags;
  int count = sscanf(input.c_str(), "S|%8[0-9a-f]|%lu|%lu|%c|%c|%c|%c|%u|%8[0-9a-f]|%c%c", session, &seq, &seconds, &nextPhase, &nextStatus, &nextExpression, &nextPresence, &effectFlags, cueId, &cueCode, &extra);
  if (count != 10 || strlen(session) != 8 || strlen(cueId) != 8 || seq == 0 || seconds > 10800 || effectFlags > 3 || !strchr("fb",nextPhase) || !strchr("irpc",nextStatus) || !strchr("nhtc",nextExpression) || !strchr("pau",nextPresence) || !strchr("ngwd",cueCode)) return false;
  if (strcmp(session,currentSession) == 0 && seq <= lastSeq) return false;
  strcpy(currentSession,session); lastSeq = seq; remaining = seconds;
  phase = nextPhase; status = nextStatus; expression = nextExpression; presence = nextPresence;
  timer_effects::accept(effectFlags,cueId,cueCode);
  receivedAt = millis(); hasState = true;
  NetworkAck ack{};
  snprintf(ack.text,sizeof(ack.text),"{\"type\":\"sync_ack\",\"protocol\":2,\"session\":\"%s\",\"seq\":%lu,\"remaining_seconds\":%lu,\"expression\":\"%s\",\"status\":\"%s\",\"effect_id\":\"%s\",\"render_count\":%lu,\"audio_ready\":%s,\"motion_busy\":%s,\"screen_sleeping\":%s}",currentSession,lastSeq,seconds,expressionName(),statusName(),cueId,(unsigned long)renderCount,!body_motion::busy&&audioSubsystemReady()?"true":"false",body_motion::busy?"true":"false",screen_idle::sleeping?"true":"false");
  Serial.println(ack.text);
  if(networkEnabled){if(realtimeConnected&&realtimeAcks)xQueueOverwrite(realtimeAcks,&ack);else xQueueOverwrite(networkAcks,&ack);}
  return true;
}
#include "TouchControls.h"
void drawScreen() {
  bool live = hasState && millis() - receivedAt < (networkEnabled ? 15000 : 5000);
  uint32_t elapsed = (millis() - receivedAt) / 1000;
  uint32_t seconds = status == 'r' ? (remaining > elapsed ? remaining - elapsed : 0) : remaining;
  if (!live) seconds = 0;
  static bool drawn = false, previousLive = false;
  static uint32_t previousSeconds = 0;
  static char previousPhase = 0, previousStatus = 0, previousExpression = 0, previousPresence = 0;
  static uint32_t previousAnimation = 0xffffffff;
  bool speaking = audioStage == 3, listening = audioStage == 2, cue = audioStage == 1;
  auto pose=face_animation::pose(expression,millis(),speaking,listening,cue,speaking?speakingMouthFrame():0);
  uint32_t animation=pose.key()|(uint32_t(speaking?1:listening?2:cue?3:0)<<22);
  bool semanticChanged = touch_controls::changed || screen_idle::redrawOnWake || !drawn || previousLive != live || previousSeconds != seconds || previousPhase != phase || previousStatus != status || previousExpression != expression || previousPresence != presence;
  if (frame.width() == 0 || (!semanticChanged && previousAnimation == animation)) return;
  frame.fillScreen(0x1947);
  frame.setTextColor(0xEFB5,0x1947); frame.setTextSize(1);
  frame.setCursor(12,10); frame.print(networkEnabled ? (live ? "WIFI LIVE" : "WIFI DISCONNECTED") : (live ? "USB LIVE" : "USB DISCONNECTED"));
  frame.setCursor(204,10); frame.print(presence == 'p' ? "PRESENT" : presence == 'a' ? "ABSENT" : "UNKNOWN");
  drawExpressionFace(pose,speaking,listening,cue);
  frame.setTextSize(1); frame.setCursor(36,155);
  if (listening) frame.print("LISTENING / speak now");
  else if (speaking) frame.print("SPEAKING / character voice");
  else if (cue) frame.print("GET READY / microphone next");
  else frame.printf("%s / %s", phase == 'f' ? "FOCUS" : "BREAK", live ? statusName() : "waiting for host");
  frame.setTextSize(4); frame.setCursor(98,176);
  if (live) frame.printf("%02lu:%02lu",(unsigned long)(seconds/60),(unsigned long)(seconds%60));
  else frame.print("--:--");
  frame.setTextSize(1);
  touch_controls::draw();
  frame.pushSprite(0, 0);
  if(screen_idle::redrawOnWake)Serial.printf("{\"type\":\"display_redrawn\",\"wake_to_draw_ms\":%lu}\n",(unsigned long)(millis()-screen_idle::wakeAt));
  screen_idle::redrawOnWake=false;
  if (semanticChanged) ++renderCount;
  drawn = true; previousLive = live; previousSeconds = seconds;
  previousPhase = phase; previousStatus = status; previousExpression = expression; previousPresence = presence;
  previousAnimation = animation;
}
void setup() {
  Serial.begin(115200); input.reserve(160); serialInput.reserve(160);
  auto config = M5.config();
  config.internal_imu = false; config.internal_rtc = false;
  config.internal_spk = true; config.internal_mic = true;
  M5.begin(config); M5.Display.setRotation(1); M5.Display.setBrightness(90);
  M5.Speaker.end(); M5.Mic.end();
  frame.setColorDepth(16);
  if (!frame.createSprite(M5.Display.width(), M5.Display.height())) {
    M5.Display.fillScreen(0);
    M5.Display.setCursor(10,10); M5.Display.print("Display buffer allocation failed");
    return;
  }
  body_motion::begin();
  screen_idle::begin();
  startNetwork();
  drawScreen();
}
void loop() {
  if (!cameraBusReleased&&!body_motion::busy) M5.update();
  if (networkEnabled) {
    NetworkFrame incoming{};
    if (xQueueReceive(networkFrames,&incoming,0) == pdTRUE) {
      input=incoming.text;bool accepted=applyFrame();input="";
      if(accepted&&!body_motion::busy&&!incoming.realtimeOnly){
        if(incoming.camera&&!cameraBusReleased)timer_effects::suspendForCamera();
        if(!audioStage)cameraControl(incoming.camera&&!screen_idle::sleeping?"C|1":"C|0");
        startAudio(incoming.audio,incoming.volume,incoming.speakerOnly,incoming.outputGain,incoming.speech);
      }
      if(accepted){screen_idle::activity(incoming.activityId);timer_effects::motionDegrees=constrain(incoming.timerDegrees,5,30);body_motion::sync(incoming);}
    }
  }
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      if (!serialOverflow) {
        if(screen_idle::command(serialInput)){
          // Local display diagnostics do not affect the timer or motors.
        }else if (serialInput.startsWith("M|")) {
          body_motion::serial(serialInput);
          // Safety commands remain available while Wi-Fi state sync is active.
        } else if (!networkEnabled) {
          input = serialInput;
          if (input.startsWith("C|")) cameraControl(input); else applyFrame();
          input = "";
        }
      }
      serialInput = "";
      serialOverflow = false;
    } else if (c != '\r') {
      if (serialInput.length() < 159 && !serialOverflow) serialInput += c;
      else serialOverflow = true;
    }
  }
  bool wasSleeping=screen_idle::sleeping;
  screen_idle::service(status);
  touch_controls::service(wasSleeping);
  if (!screen_idle::sleeping&&(screen_idle::redrawOnWake||millis() - lastDraw >= 50)) { lastDraw = millis(); drawScreen(); }
  if(!body_motion::busy){serviceAudio();if(!audioStage&&!screen_idle::sleeping)serviceCamera();motor_safety::service();}
  bool live=hasState && millis()-receivedAt < (networkEnabled?15000:5000);
  uint32_t elapsed=(millis()-receivedAt)/1000;
  uint32_t effectSeconds=status=='r' ? (remaining>elapsed?remaining-elapsed:0) : remaining;
  timer_effects::service(phase,status,effectSeconds,live,audioStage,cameraBusReleased);
  delay(5);
}
