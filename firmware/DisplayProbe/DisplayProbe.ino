#include <M5Unified.h>
#include "NetworkTransport.h"
#include "CameraTransport.h"
#include "AudioProbe.h"

// Protocol v1: S|session8hex|seq|seconds|phase|status|expression|presence\n
// All commands are display state only. No motor or timer control commands.
String input;
bool overflow = false, hasState = false;
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
void applyFrame() {
  char session[9], nextPhase, nextStatus, nextExpression, nextPresence, extra;
  unsigned long seq, seconds;
  int count = sscanf(input.c_str(), "S|%8[0-9a-f]|%lu|%lu|%c|%c|%c|%c%c", session, &seq, &seconds, &nextPhase, &nextStatus, &nextExpression, &nextPresence, &extra);
  if (count != 7 || strlen(session) != 8 || seq == 0 || seconds > 10800 || !strchr("fb",nextPhase) || !strchr("irpc",nextStatus) || !strchr("nhtc",nextExpression) || !strchr("pau",nextPresence)) return;
  if (strcmp(session,currentSession) == 0 && seq <= lastSeq) return;
  strcpy(currentSession,session); lastSeq = seq; remaining = seconds;
  phase = nextPhase; status = nextStatus; expression = nextExpression; presence = nextPresence;
  receivedAt = millis(); hasState = true;
  NetworkAck ack{};
  snprintf(ack.text,sizeof(ack.text),"{\"type\":\"sync_ack\",\"protocol\":1,\"session\":\"%s\",\"seq\":%lu,\"remaining_seconds\":%lu,\"expression\":\"%s\",\"status\":\"%s\",\"render_count\":%lu}",currentSession,lastSeq,seconds,expressionName(),statusName(),(unsigned long)renderCount);
  Serial.println(ack.text);
  if (networkEnabled) xQueueOverwrite(networkAcks,&ack);
}
void drawScreen() {
  bool live = hasState && millis() - receivedAt < (networkEnabled ? 15000 : 5000);
  uint32_t elapsed = (millis() - receivedAt) / 1000;
  uint32_t seconds = status == 'r' ? (remaining > elapsed ? remaining - elapsed : 0) : remaining;
  if (!live) seconds = 0;
  static bool drawn = false, previousLive = false;
  static uint32_t previousSeconds = 0;
  static char previousPhase = 0, previousStatus = 0, previousExpression = 0, previousPresence = 0;
  if (frame.width() == 0 || (drawn && previousLive == live && previousSeconds == seconds && previousPhase == phase && previousStatus == status && previousExpression == expression && previousPresence == presence)) return;
  frame.fillScreen(0x1947);
  frame.setTextColor(0xEFB5,0x1947); frame.setTextSize(1);
  frame.setCursor(12,10); frame.print(networkEnabled ? (live ? "WIFI LIVE" : "WIFI DISCONNECTED") : (live ? "USB LIVE" : "USB DISCONNECTED"));
  frame.setCursor(204,10); frame.print(presence == 'p' ? "PRESENT" : presence == 'a' ? "ABSENT" : "UNKNOWN");
  frame.fillRoundRect(30,32,260,112,22,0x2A49);
  int eyeHeight = expression == 't' ? 7 : 24;
  frame.fillRoundRect(91,66,17,eyeHeight,6,0xEFB5);
  frame.fillRoundRect(212,66,17,eyeHeight,6,0xEFB5);
  if (expression == 'c') {
    frame.drawLine(145,118,160,111,0xEFB5); frame.drawLine(160,111,175,118,0xEFB5);
  } else if (expression == 'h') {
    frame.fillRoundRect(147,105,26,20,8,0xEFB5);
  } else {
    frame.drawLine(145,111,160,118,0xEFB5); frame.drawLine(160,118,175,111,0xEFB5);
  }
  frame.setTextSize(1); frame.setCursor(36,155);
  frame.printf("%s / %s", phase == 'f' ? "FOCUS" : "BREAK", live ? statusName() : "waiting for host");
  frame.setTextSize(4); frame.setCursor(98,176);
  if (live) frame.printf("%02lu:%02lu",(unsigned long)(seconds/60),(unsigned long)(seconds%60));
  else frame.print("--:--");
  frame.setTextSize(1); frame.setCursor(100,224); frame.print("ATK STACKCHAN");
  frame.pushSprite(0, 0);
  ++renderCount;
  drawn = true; previousLive = live; previousSeconds = seconds;
  previousPhase = phase; previousStatus = status; previousExpression = expression; previousPresence = presence;
}
void setup() {
  Serial.begin(115200); input.reserve(120);
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
  startNetwork();
  drawScreen();
}
void loop() {
  if (!cameraBusReleased) M5.update();
  if (networkEnabled) {
    NetworkFrame incoming{};
    if (xQueueReceive(networkFrames,&incoming,0) == pdTRUE) { input = incoming.text; applyFrame(); input = ""; if(!audioStage) cameraControl(incoming.camera ? "C|1" : "C|0"); startAudio(incoming.audio,incoming.volume,incoming.speakerOnly,incoming.outputGain,incoming.speech); }
  }
  while (Serial.available()) {
    char c = Serial.read();
    if (networkEnabled) continue;
    if (c == '\n') { if (!overflow) { if (input.startsWith("C|")) cameraControl(input); else applyFrame(); } input = ""; overflow = false; }
    else if (c != '\r') { if (input.length() < 119 && !overflow) input += c; else overflow = true; }
  }
  if (millis() - lastDraw >= 250) { lastDraw = millis(); drawScreen(); }
  serviceAudio();
  if(!audioStage) serviceCamera();
  delay(5);
}
