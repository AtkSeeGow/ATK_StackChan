#pragma once

namespace timer_effects {

static uint8_t flags = 0;
static char lastCueId[9] = "00000000";
static char pendingCue = 'n';
static uint32_t pendingAt = 0;
static uint32_t lastMotionAt = 0;
static uint32_t lightCueAt = 0;
static char lightCue = 'n';
static uint32_t lastLightUpdate = 0;
static bool lightsWereOn = false;
static int motionDegrees=15;

inline uint8_t triangle(uint32_t now, uint32_t period, uint8_t low, uint8_t high) {
  uint32_t half = period / 2;
  uint32_t position = now % period;
  uint32_t rising = position <= half ? position : period - position;
  return low + (high - low) * rising / half;
}

inline void accept(uint8_t nextFlags, const char* cueId, char cueCode) {
  flags = nextFlags;
  if (strcmp(cueId, "00000000") && strcmp(cueId, lastCueId)) {
    strcpy(lastCueId, cueId);
    pendingCue = cueCode;
    pendingAt = millis();
    lightCue = cueCode;
    lightCueAt = millis();
  }
}

inline void suspendForCamera() {
  if (lightsWereOn) motor_safety::setBodyLights(0, 0, 0);
  lightsWereOn = false;
  motor_safety::invalidateLights();
}

inline void serviceMotion(uint8_t audioStage, bool cameraBusReleased) {
  if (pendingCue == 'n') return;
  uint32_t now = millis();
  if (!(flags & 2) || now - pendingAt > 15000) { pendingCue = 'n'; return; }
  if (audioStage || cameraBusReleased || body_motion::busy || (lastMotionAt && now - lastMotionAt < 20000)) return;
  // Queue a bounded symmetric gesture around the saved center. The main
  // loop keeps rendering; pitch remains disabled in the motion worker.
  if(body_motion::gesture(motionDegrees)){pendingCue='n';lastMotionAt=now;}
}

inline void serviceLights(char phase, char status, uint32_t seconds, bool live, uint8_t audioStage, bool cameraBusReleased) {
  uint32_t now = millis();
  if (now - lastLightUpdate < 125) return;
  lastLightUpdate = now;
  if (!(flags & 1) || cameraBusReleased) {
    if (!(flags & 1) && lightsWereOn) motor_safety::setBodyLights(0, 0, 0);
    lightsWereOn = false;
    return;
  }

  uint8_t red = 0, green = 0, blue = 0;
  if (!live) {
    bool blink = now % 1800 < 160 || (now % 1800 >= 320 && now % 1800 < 480);
    red = blink ? 28 : 0;
  } else if (audioStage == 2) {
    green = triangle(now, 700, 8, 36);
  } else if (audioStage == 3) {
    red = 10; blue = triangle(now, 800, 14, 42);
  } else if (audioStage == 1) {
    red = 18; blue = 30;
  } else if (lightCue != 'n' && now - lightCueAt < 3000) {
    uint8_t level = triangle(now, lightCue == 'd' ? 700 : 1000, 6, 42);
    if (lightCue == 'd') { red = level; green = level; }
    else if (lightCue == 'w') red = level;
    else { green = level / 2; blue = level; }
  } else if (status == 'p') {
    red = 18; green = 8;
  } else if (status == 'c') {
    green = triangle(now, 1800, 5, 28); red = green / 3;
  } else if (status == 'r' && phase == 'b') {
    green = triangle(now, 2600, 3, 24); blue = green / 2;
  } else if (status == 'r' && seconds <= 30) {
    red = triangle(now, 650, 5, 40);
  } else if (status == 'r' && seconds <= 300) {
    red = triangle(now, 1600, 5, 32); green = red / 3;
  } else if (status == 'r') {
    blue = triangle(now, 3200, 3, 24); green = blue / 4;
  } else {
    blue = 4;
  }
  lightsWereOn = motor_safety::setBodyLights(red, green, blue);
}

inline void service(char phase, char status, uint32_t seconds, bool live, uint8_t audioStage, bool cameraBusReleased) {
  serviceMotion(audioStage, cameraBusReleased);
  serviceLights(phase, status, seconds, live, audioStage, cameraBusReleased);
}

}  // namespace timer_effects
