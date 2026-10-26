#include <M5Unified.h>
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
uint8_t entryAnimationFrame(uint32_t cycleMs, uint32_t frameMs) {
  uint32_t position = millis() % cycleMs;
  return position < frameMs * 4 ? position / frameMs : 0;
}
uint8_t neutralIdleFrame() {
  uint32_t position = millis() % 9000;
  if (position < 480) return position / 120;
  if (position >= 5200 && position < 6400) return 32 + (position-5200)/300;
  return 0;
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
void drawExpressionFace(uint8_t animation, bool speaking, bool listening, bool cue) {
  constexpr uint16_t backgroundColor = 0x1947;
  constexpr uint16_t outlineColor = 0x7CE7;
  constexpr uint16_t faceColor = 0x2A49;
  constexpr uint16_t featureColor = 0xEFB5;
  constexpr uint16_t accentColor = 0xAEB8;
  uint8_t spriteFrame = animation & 3;
  bool lookingAround = animation >= 32 && animation <= 35;
  int bob = 0, squash = 0;
  if (expression == 'h' && !speaking && !listening && !cue) {
    const int8_t happyBob[4] = {0,-4,-8,2};
    bob = happyBob[spriteFrame];
    squash = spriteFrame == 3 ? 6 : 0;
  }
  int faceX = 30, faceY = 32 + bob + squash/2, faceW = 260, faceH = 112 - squash;
  int centerY = faceY + faceH/2;

  // Draw expanding listening rings first, then cover their inner halves with the face.
  if (listening) {
    for (uint8_t ring=0; ring<spriteFrame; ++ring) {
      int radius = 12 + ring*9;
      frame.drawCircle(faceX,centerY,radius,accentColor);
      frame.drawCircle(faceX+faceW,centerY,radius,accentColor);
    }
  }
  frame.fillRoundRect(faceX,faceY,faceW,faceH,22,outlineColor);
  frame.fillRoundRect(faceX+6,faceY+6,faceW-12,faceH-12,17,faceColor);

  int eyeTop = faceY + 34;
  int leftX = 91, rightX = 212;
  if (lookingAround && spriteFrame == 1) { leftX -= 9; rightX -= 9; }
  else if (lookingAround && spriteFrame == 3) { leftX += 9; rightX += 9; }
  int eyeHeight = expression == 'h' ? 18 : 26;
  bool neutralBlink = expression == 'n' && !speaking && !listening && !cue && !lookingAround && (spriteFrame == 1 || spriteFrame == 2);
  bool teasingBlink = expression == 't' && !speaking && !listening && !cue && (spriteFrame == 1 || spriteFrame == 2);

  if (expression == 'h' && !speaking && !listening && !cue && spriteFrame == 2) {
    frame.drawLine(leftX-2,eyeTop+10,leftX+7,eyeTop+15,featureColor);
    frame.drawLine(leftX+7,eyeTop+15,leftX+16,eyeTop+10,featureColor);
    frame.drawLine(rightX-2,eyeTop+10,rightX+7,eyeTop+15,featureColor);
    frame.drawLine(rightX+7,eyeTop+15,rightX+16,eyeTop+10,featureColor);
  } else {
    int leftHeight = eyeHeight, rightHeight = eyeHeight;
    int leftTop = eyeTop, rightTop = eyeTop;
    if (neutralBlink) {
      leftHeight = rightHeight = spriteFrame == 2 ? 4 : 10;
      leftTop += (eyeHeight-leftHeight)/2; rightTop += (eyeHeight-rightHeight)/2;
    } else if (expression == 't') {
      // Keep both eyes geometrically identical. The playful character comes from
      // the smirk below instead of an asymmetric wink that reads as "uneven eyes".
      leftHeight = rightHeight = teasingBlink ? (spriteFrame == 2 ? 4 : 10) : eyeHeight;
      leftTop += (eyeHeight-leftHeight)/2; rightTop += (eyeHeight-rightHeight)/2;
    }
    frame.fillRoundRect(leftX,leftTop,17,leftHeight,min(6,leftHeight/2),featureColor);
    frame.fillRoundRect(rightX,rightTop,17,rightHeight,min(6,rightHeight/2),featureColor);
  }

  if (expression == 'c') {
    int browLift = spriteFrame == 2 ? 4 : 0;
    frame.drawLine(87,faceY+27-browLift,108,faceY+21-browLift,featureColor);
    frame.drawLine(212,faceY+21-browLift,233,faceY+27-browLift,featureColor);
  }

  int mouthY = faceY + 78;
  if (speaking) {
    if (spriteFrame == 0) frame.fillRect(148,mouthY+7,24,4,featureColor);
    else if (spriteFrame == 1) frame.fillRoundRect(153,mouthY+3,14,10,4,featureColor);
    else if (spriteFrame == 2) frame.fillRoundRect(149,mouthY,22,16,6,featureColor);
    else frame.fillRoundRect(145,mouthY-4,30,24,9,featureColor);
  } else if (expression == 'h') {
    frame.fillRoundRect(147,mouthY-2,26,20,8,featureColor);
  } else if (expression == 't') {
    frame.drawLine(144,mouthY+8,159,mouthY+8,featureColor);
    frame.drawLine(159,mouthY+8,176,mouthY,featureColor);
  } else if (expression == 'c') {
    int depth = spriteFrame == 2 ? 9 : 6;
    frame.drawLine(145,mouthY+depth,160,mouthY,featureColor);
    frame.drawLine(160,mouthY,175,mouthY+depth,featureColor);
  } else {
    frame.fillRect(148,mouthY+7,24,4,featureColor);
  }

  if (cue) frame.fillCircle(160,faceY+faceH-9,3+spriteFrame*3,accentColor);
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
  static uint8_t previousAnimation = 255;
  bool speaking = audioStage == 3, listening = audioStage == 2, cue = audioStage == 1;
  uint8_t animation = 0;
  if (speaking) animation = 20 + speakingMouthFrame();
  else if (listening) animation = 24 + (millis()/220)%4;
  else if (cue) animation = 28 + (millis()/220)%2;
  else if (expression == 'h') animation = 4 + entryAnimationFrame(2400,180);
  else if (expression == 't') animation = 8 + entryAnimationFrame(3200,150);
  else if (expression == 'c') animation = 12 + entryAnimationFrame(2800,180);
  else animation = neutralIdleFrame();
  bool semanticChanged = touch_controls::changed || screen_idle::redrawOnWake || !drawn || previousLive != live || previousSeconds != seconds || previousPhase != phase || previousStatus != status || previousExpression != expression || previousPresence != presence;
  if (frame.width() == 0 || (!semanticChanged && previousAnimation == animation)) return;
  frame.fillScreen(0x1947);
  frame.setTextColor(0xEFB5,0x1947); frame.setTextSize(1);
  frame.setCursor(12,10); frame.print(networkEnabled ? (live ? "WIFI LIVE" : "WIFI DISCONNECTED") : (live ? "USB LIVE" : "USB DISCONNECTED"));
  frame.setCursor(204,10); frame.print(presence == 'p' ? "PRESENT" : presence == 'a' ? "ABSENT" : "UNKNOWN");
  drawExpressionFace(animation,speaking,listening,cue);
  frame.setTextSize(1); frame.setCursor(36,155);
  if (listening) frame.print("LISTENING / speak now");
  else if (speaking) frame.print("SPEAKING / character voice");
  else if (cue) frame.print("GET READY / microphone next");
  else frame.printf("%s / %s", phase == 'f' ? "FOCUS" : "BREAK", live ? statusName() : "waiting for host");
  frame.setTextSize(4); frame.setCursor(98,176);
  if (live) frame.printf("%02lu:%02lu",(unsigned long)(seconds/60),(unsigned long)(seconds%60));
  else frame.print("--:--");
  frame.setTextSize(1); frame.setCursor(100,224); frame.print("ATK STACKCHAN");
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
  if (!screen_idle::sleeping&&(screen_idle::redrawOnWake||millis() - lastDraw >= 100)) { lastDraw = millis(); drawScreen(); }
  if(!body_motion::busy){serviceAudio();if(!audioStage&&!screen_idle::sleeping)serviceCamera();motor_safety::service();}
  bool live=hasState && millis()-receivedAt < (networkEnabled?15000:5000);
  uint32_t elapsed=(millis()-receivedAt)/1000;
  uint32_t effectSeconds=status=='r' ? (remaining>elapsed?remaining-elapsed:0) : remaining;
  timer_effects::service(phase,status,effectSeconds,live,audioStage,cameraBusReleased);
  delay(5);
}
