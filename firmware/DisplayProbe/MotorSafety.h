#pragma once

#include <M5StackChan.h>
#include <Preferences.h>
#include <drivers/FTServo_Arduino/src/SCSCL.h>
#include <drivers/PY32IOExpander/PY32IOExpander.hpp>
#include <utility/power/INA226_Class.hpp>
#include <freertos/semphr.h>

// K151-R motor safety probe.
//
// Important invariants:
// - Boot does not initialise or power the servos.
// - No calibration or servo settings are written to NVS/EEPROM.
// - Pitch never receives a motion command in the first safety stage.
// - Legacy probe-relative yaw is limited to +/-10 raw steps. Supervised and
//   web gestures allow 5..30 degrees; center trim is limited to +/-15 degrees.
// - Torque and servo power are disabled after every operation.
namespace motor_safety {

constexpr uint8_t kPowerPin = 0;
constexpr uint8_t kYawId = 1;
constexpr uint8_t kPitchId = 2;
constexpr int kRawMinimum = 0;
constexpr int kRawMaximum = 1000;
constexpr int kYawTestSteps = 10;
constexpr uint32_t kPowerTimeoutMs = 3000;
constexpr int kDefaultYawHome = 460;
static int centerOffsetDegrees = 0;
inline int centerRawOffset() { return (abs(centerOffsetDegrees)*32+5)/10*(centerOffsetDegrees<0?-1:1); }

static m5::PY32IOExpander_Class powerExpander;
static SCSCL servoBus;
static bool uartReady = false;
static bool directRawUartReady = false;
static bool expanderReady = false;
static bool powerEnabled = false;
static uint32_t powerEnabledAt = 0;
static int yawTorqueOffAck = -1;
static int pitchTorqueOffAck = -1;
static bool baselineValid = false;
static int baselineYaw = -1;
static int baselinePitch = -1;
static SemaphoreHandle_t hardwareMutex = nullptr;
inline void initializeHardwareLock(){hardwareMutex=xSemaphoreCreateRecursiveMutex();}
struct HardwareGuard {
  HardwareGuard(){if(hardwareMutex)xSemaphoreTakeRecursive(hardwareMutex,portMAX_DELAY);}
  ~HardwareGuard(){if(hardwareMutex)xSemaphoreGiveRecursive(hardwareMutex);}
};

inline bool validRawPosition(int value) {
  return value >= kRawMinimum && value <= kRawMaximum;
}

inline void reportFailure(const char* operation, const char* reason) {
  Serial.printf("{\"type\":\"motor_safety\",\"op\":\"%s\",\"ok\":false,\"reason\":\"%s\",\"power\":\"off\"}\n", operation, reason);
}

inline bool prepareInterface() {
  HardwareGuard guard;
  // The camera SCCB driver takes over the same internal I2C controller used by
  // the body IO expander. Always stop/deinit the camera and restore M5's I2C
  // controller before touching VM_EN. A previous successful begin is not proof
  // that the bus is still owned by M5.In_I2C.
  cameraControl("C|0");
  if (cameraBusReleased) {
    M5.In_I2C.begin();
    cameraBusReleased = false;
    delay(20);
  }

  expanderReady = false;
  uint32_t startedAt = millis();
  do {
    if (powerExpander.begin()) {
      expanderReady = true;
      break;
    }
    delay(100);
  } while (millis() - startedAt < 1200);
  if (!expanderReady) return false;
  if (!powerExpander.setDirection(kPowerPin, true)) return false;
  if (!powerExpander.setPullMode(kPowerPin, m5::PY32IOExpander_Class::pull_up)) return false;
  if (!powerExpander.digitalWrite(kPowerPin, false)) return false;
  return true;
}

inline bool startServoBus() {
  // Match the factory order: the servos are powered and allowed to settle
  // before UART1 is installed on GPIO 6/7. Recreate the UART driver after
  // every power cycle so an earlier unpowered session cannot be reused.
  if (uartReady) {
    servoBus.end();
    uartReady = false;
  }
  if (!servoBus.begin(UART_NUM_1, 1000000, 6, 7)) return false;
  uartReady = true;
  return true;
}

inline bool startDirectRawBus() {
  // Keep the no-motion diagnostic independent of FTServo_Arduino's queued TX
  // path.  The known-good ESP-IDF StackChan driver uses a 256-byte RX buffer
  // and synchronous TX (tx_buffer_size == 0) on this hardware.
  if (uartReady) {
    servoBus.end();
    uartReady = false;
  }
  if (directRawUartReady) {
    uart_driver_delete(UART_NUM_1);
    directRawUartReady = false;
  }
  const uart_config_t config = {
      .baud_rate = 1000000,
      .data_bits = UART_DATA_8_BITS,
      .parity = UART_PARITY_DISABLE,
      .stop_bits = UART_STOP_BITS_1,
      .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
      .rx_flow_ctrl_thresh = 0,
      .source_clk = UART_SCLK_DEFAULT,
      .flags = {},
  };
  if (uart_driver_install(UART_NUM_1, 256, 0, 0, nullptr, 0) != ESP_OK) return false;
  if (uart_param_config(UART_NUM_1, &config) != ESP_OK ||
      uart_set_pin(UART_NUM_1, 6, 7, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE) != ESP_OK) {
    uart_driver_delete(UART_NUM_1);
    return false;
  }
  directRawUartReady = true;
  return true;
}

inline void powerOff() {
  HardwareGuard guard;
  if (uartReady && powerEnabled) {
    servoBus.EnableTorque(kYawId, 0);
    servoBus.EnableTorque(kPitchId, 0);
    delay(20);
  }
  if (expanderReady) powerExpander.digitalWrite(kPowerPin, false);
  if (uartReady) {
    servoBus.end();
    uartReady = false;
  }
  if (directRawUartReady) {
    uart_driver_delete(UART_NUM_1);
    directRawUartReady = false;
  }
  powerEnabled = false;
  powerEnabledAt = 0;
}

inline bool powerOnWithoutTorque() {
  HardwareGuard guard;
  if (!prepareInterface()) return false;
  if (!powerExpander.digitalWrite(kPowerPin, true)) return false;
  if (!powerExpander.getWriteValue(kPowerPin)) {
    powerExpander.digitalWrite(kPowerPin, false);
    return false;
  }
  powerEnabled = true;
  powerEnabledAt = millis();
  delay(250);
  if (!startServoBus()) {
    powerOff();
    return false;
  }
  yawTorqueOffAck = servoBus.EnableTorque(kYawId, 0);
  pitchTorqueOffAck = servoBus.EnableTorque(kPitchId, 0);
  delay(30);
  return true;
}

inline size_t rawPing(uint8_t id, uint8_t* response, size_t capacity) {
  const uint8_t packet[] = {0xff, 0xff, id, 0x02, 0x01, static_cast<uint8_t>(~(id + 0x03))};
  uart_flush_input(UART_NUM_1);
  if (uart_write_bytes(UART_NUM_1, packet, sizeof(packet)) != sizeof(packet)) return 0;
  if (uart_wait_tx_done(UART_NUM_1, pdMS_TO_TICKS(30)) != ESP_OK) return 0;
  // The library parser waits 10 ms. Capture for longer here to distinguish a
  // late but valid reply from a completely silent RX line.
  int received = uart_read_bytes(UART_NUM_1, response, capacity, pdMS_TO_TICKS(100));
  return received > 0 ? static_cast<size_t>(received) : 0;
}

inline void rawProbe() {
  if (!prepareInterface()) {
    reportFailure("raw_probe", "control_interface_unavailable");
    return;
  }

  m5::INA226_Class monitor(0x41);
  bool monitorReady = monitor.begin();
  float busOff = monitorReady ? monitor.getBusVoltage() : -1.0f;
  float shuntOff = monitorReady ? monitor.getShuntVoltage() : 0.0f;

  if (!powerExpander.digitalWrite(kPowerPin, true) || !powerExpander.getWriteValue(kPowerPin)) {
    powerOff();
    reportFailure("raw_probe", "servo_power_enable_failed");
    return;
  }
  powerEnabled = true;
  powerEnabledAt = millis();
  delay(250);
  float busOn = monitorReady ? monitor.getBusVoltage() : -1.0f;
  float shuntOn = monitorReady ? monitor.getShuntVoltage() : 0.0f;
  if (!startDirectRawBus()) {
    powerOff();
    reportFailure("raw_probe", "uart_start_failed");
    return;
  }

  uint8_t yawReply[16] = {};
  uint8_t pitchReply[16] = {};
  size_t yawLength = rawPing(kYawId, yawReply, sizeof(yawReply));
  size_t pitchLength = rawPing(kPitchId, pitchReply, sizeof(pitchReply));
  char yawHex[33] = {};
  char pitchHex[33] = {};
  for (size_t i = 0; i < yawLength; ++i) snprintf(yawHex + i * 2, sizeof(yawHex) - i * 2, "%02X", yawReply[i]);
  for (size_t i = 0; i < pitchLength; ++i) snprintf(pitchHex + i * 2, sizeof(pitchHex) - i * 2, "%02X", pitchReply[i]);
  powerOff();
  Serial.printf("{\"type\":\"motor_safety\",\"op\":\"raw_probe\",\"ok\":true,\"servo_reply\":%s,\"yaw_rx_count\":%u,\"yaw_rx_hex\":\"%s\",\"pitch_rx_count\":%u,\"pitch_rx_hex\":\"%s\",\"ina226\":%s,\"bus_off_v\":%.4f,\"bus_on_v\":%.4f,\"shunt_off_v\":%.6f,\"shunt_on_v\":%.6f,\"power\":\"off\"}\n",
                (yawLength || pitchLength) ? "true" : "false", static_cast<unsigned>(yawLength), yawHex,
                static_cast<unsigned>(pitchLength), pitchHex, monitorReady ? "true" : "false",
                busOff, busOn, shuntOff, shuntOn);
}

inline void probe() {
  if (!powerOnWithoutTorque()) {
    reportFailure("probe", "io_expander_unavailable");
    return;
  }
  int yawPing = servoBus.Ping(kYawId);
  int pitchPing = servoBus.Ping(kPitchId);
  int yaw = servoBus.ReadPos(kYawId);
  int pitch = servoBus.ReadPos(kPitchId);
  int yawTorque = servoBus.ReadToqueEnable(kYawId);
  int pitchTorque = servoBus.ReadToqueEnable(kPitchId);
  powerOff();
  if (!validRawPosition(yaw) || !validRawPosition(pitch)) {
    baselineValid = false;
    Serial.printf("{\"type\":\"motor_safety\",\"op\":\"probe\",\"ok\":false,\"reason\":\"invalid_servo_position\",\"yaw_ping\":%d,\"pitch_ping\":%d,\"yaw_torque_off_ack\":%d,\"pitch_torque_off_ack\":%d,\"yaw_raw\":%d,\"pitch_raw\":%d,\"power\":\"off\"}\n",
                  yawPing, pitchPing, yawTorqueOffAck, pitchTorqueOffAck, yaw, pitch);
    return;
  }
  baselineYaw = yaw;
  baselinePitch = pitch;
  baselineValid = true;
  Serial.printf("{\"type\":\"motor_safety\",\"op\":\"probe\",\"ok\":true,\"yaw_ping\":%d,\"pitch_ping\":%d,\"yaw_torque_off_ack\":%d,\"pitch_torque_off_ack\":%d,\"yaw_raw\":%d,\"pitch_raw\":%d,\"yaw_torque\":%d,\"pitch_torque\":%d,\"power\":\"off\"}\n",
                yawPing, pitchPing, yawTorqueOffAck, pitchTorqueOffAck, yaw, pitch, yawTorque, pitchTorque);
}

inline void moveYawTo(int target, const char* operation) {
  if (!baselineValid) {
    reportFailure(operation, "probe_required");
    return;
  }
  if (target < baselineYaw - kYawTestSteps || target > baselineYaw + kYawTestSteps || !validRawPosition(target)) {
    reportFailure(operation, "target_outside_test_window");
    return;
  }
  if (!powerOnWithoutTorque()) {
    reportFailure(operation, "io_expander_unavailable");
    return;
  }
  int currentYaw = servoBus.ReadPos(kYawId);
  int currentPitch = servoBus.ReadPos(kPitchId);
  if (!validRawPosition(currentYaw) || !validRawPosition(currentPitch) || abs(currentYaw - baselineYaw) > 40 || abs(currentPitch - baselinePitch) > 40) {
    powerOff();
    reportFailure(operation, "position_changed_since_probe");
    return;
  }

  // Load the current position as the goal before enabling torque so an old goal
  // cannot cause a snap. Then walk one raw step at a time to the tiny test target.
  servoBus.WritePos(kYawId, currentYaw, 20, 0);
  servoBus.EnableTorque(kYawId, 1);
  delay(80);
  int direction = target >= currentYaw ? 1 : -1;
  for (int position = currentYaw; position != target; position += direction) {
    if (millis() - powerEnabledAt >= kPowerTimeoutMs) break;
    int next = position + direction;
    servoBus.WritePos(kYawId, next, 20, 0);
    delay(60);
  }
  delay(120);
  int finalYaw = servoBus.ReadPos(kYawId);
  powerOff();
  Serial.printf("{\"type\":\"motor_safety\",\"op\":\"%s\",\"ok\":%s,\"baseline_yaw_raw\":%d,\"target_yaw_raw\":%d,\"final_yaw_raw\":%d,\"power\":\"off\"}\n",
                operation, validRawPosition(finalYaw) ? "true" : "false", baselineYaw, target, finalYaw);
}

inline bool settleYaw(int target,uint32_t timeoutMs) {
  for(int repeat=0;repeat<4;++repeat){
    if(millis()-powerEnabledAt>=timeoutMs)return false;
    servoBus.WritePos(kYawId,target,300,0);
    delay(250);
  }
  delay(500);
  return millis()-powerEnabledAt<timeoutMs;
}

inline void openLoopYawSafetyTest(int steps = kYawTestSteps) {
  constexpr uint32_t gestureTimeoutMs = 5000;
  if (steps != 10 && steps != 20) return;
  const char* operation = steps == 20 ? "yaw_open_loop_6deg" : "yaw_open_loop_3deg";
  const int stride = steps / 10;
  // RX feedback is unavailable on this unit in the custom firmware.  This
  // explicitly supervised fallback is only valid immediately after the
  // factory Servo Test has returned the mechanism to home.  Read the existing
  // factory calibration without creating or modifying any NVS keys.
  Preferences settings;
  int yawHome = kDefaultYawHome;
  bool settingsReady = settings.begin("servo", true);
  if (settingsReady) {
    yawHome = settings.getInt("zero_pos_1", kDefaultYawHome);
    settings.end();
  }
  yawHome += centerRawOffset();
  if (!validRawPosition(yawHome) || yawHome + steps > kRawMaximum) {
    reportFailure("yaw_open_loop_3deg", "invalid_home_calibration");
    return;
  }
  if (!prepareInterface()) {
    reportFailure("yaw_open_loop_3deg", "control_interface_unavailable");
    return;
  }
  if (!powerExpander.digitalWrite(kPowerPin, true) || !powerExpander.getWriteValue(kPowerPin)) {
    powerOff();
    reportFailure("yaw_open_loop_3deg", "servo_power_enable_failed");
    return;
  }
  powerEnabled = true;
  powerEnabledAt = millis();
  delay(250);
  if (!startServoBus()) {
    powerOff();
    reportFailure("yaw_open_loop_3deg", "uart_start_failed");
    return;
  }

  // Pitch is never enabled.  Load the known home goal before yaw torque is
  // enabled, then send ten gradual goals out and ten back. Keep the same
  // timing budget for both the 10- and 20-raw-step amplitudes.
  servoBus.EnableTorque(kPitchId, 0);
  servoBus.WritePos(kYawId, yawHome, 20, 0);
  servoBus.EnableTorque(kYawId, 1);
  delay(200);
  bool completed = true;
  for (int position = yawHome + stride; position <= yawHome + steps; position += stride) {
    if (millis() - powerEnabledAt >= gestureTimeoutMs) {
      completed = false;
      break;
    }
    servoBus.WritePos(kYawId, position, 20, 0);
    delay(80);
  }
  if (completed) {
    delay(160);
    for (int position = yawHome + steps - stride; position >= yawHome; position -= stride) {
      if (millis() - powerEnabledAt >= gestureTimeoutMs) {
        completed = false;
        break;
      }
      servoBus.WritePos(kYawId, position, 20, 0);
      delay(80);
    }
  }
  if(completed)completed=settleYaw(yawHome,gestureTimeoutMs);
  powerOff();
  Serial.printf("{\"type\":\"motor_safety\",\"op\":\"%s\",\"ok\":%s,\"command_sent\":true,\"motion_verified\":false,\"yaw_home_raw\":%d,\"yaw_peak_raw\":%d,\"pitch_torque\":\"off\",\"power\":\"off\"}\n",
                operation, completed ? "true" : "false", yawHome, yawHome + steps);
}

static bool sweepCompleted = false;
inline void supervisedYawSweep(int degrees,bool brisk=false) {
  sweepCompleted = false;
  if (degrees < 5 || degrees > 30) return;
  const int amplitude = (degrees * 32 + 5) / 10;
  const uint32_t timeoutMs = 24000;
  const char* operation = brisk ? "timer_yaw_gesture" : degrees == 30 ? "yaw_sweep_30deg" : "yaw_sweep_15deg";
  const int stride=brisk?6:3;
  const uint32_t stepMs=brisk?60:150,holdMs=brisk?60:200;
  Preferences settings;
  if (!settings.begin("servo", true)) { reportFailure(operation, "calibration_unavailable"); return; }
  int homePosition = settings.getInt("zero_pos_1", -1);
  settings.end();
  if (!validRawPosition(homePosition)) { reportFailure(operation,"invalid_home_calibration"); return; }
  homePosition += centerRawOffset();
  if (!validRawPosition(homePosition - amplitude) || !validRawPosition(homePosition + amplitude)) {
    reportFailure(operation, "invalid_home_calibration"); return;
  }
  if (!powerOnWithoutTorque()) { powerOff(); reportFailure(operation, "interface_unavailable"); return; }
  servoBus.WritePos(kYawId, homePosition, 20, 0);
  servoBus.EnableTorque(kYawId, 1);
  delay(250);
  int position = homePosition;
  bool completed = true;
  const int targets[] = {homePosition + amplitude, homePosition - amplitude, homePosition};
  for (int target : targets) {
    while (position != target) {
      if (millis() - powerEnabledAt >= timeoutMs) { completed = false; break; }
      position += target > position ? min(stride, target - position) : -min(stride, position - target);
      servoBus.WritePos(kYawId, position, 20, 0);
      delay(stepMs);
    }
    if (!completed) break;
    delay(holdMs);
  }
  if(completed)completed=settleYaw(homePosition,timeoutMs);
  powerOff();
  sweepCompleted = completed;
  Serial.printf("{\"type\":\"motor_safety\",\"op\":\"%s\",\"ok\":%s,\"motion_verified\":false,\"home_raw\":%d,\"min_raw\":%d,\"max_raw\":%d,\"last_command_raw\":%d,\"pitch_torque\":\"off\",\"power\":\"off\"}\n", operation,completed?"true":"false",homePosition,homePosition-amplitude,homePosition+amplitude,position);
}

inline bool adjustCenter(int offset) {
  if(abs(offset)>15)return false;
  Preferences calibration;
  if(!calibration.begin("servo",true))return false;
  int factoryHome=calibration.getInt("zero_pos_1",-1);
  calibration.end();
  int position=factoryHome+centerRawOffset();
  int target=factoryHome+(abs(offset)*32+5)/10*(offset<0?-1:1);
  if(!validRawPosition(factoryHome)||!validRawPosition(position)||!validRawPosition(target))return false;
  if(!powerOnWithoutTorque()){powerOff();return false;}
  servoBus.WritePos(kYawId,position,20,0);
  servoBus.EnableTorque(kYawId,1);
  delay(200);
  bool completed=true;
  while(position!=target){
    if(millis()-powerEnabledAt>=12000){completed=false;break;}
    position+=target>position?min(3,target-position):-min(3,position-target);
    servoBus.WritePos(kYawId,position,20,0);
    delay(150);
  }
  // Small corrections can fall inside gearbox backlash. Keep the final goal
  // powered long enough to settle and repeat it after torque has been enabled.
  if(completed)completed=settleYaw(target,12000);
  powerOff();
  Serial.printf("{\"type\":\"center_command\",\"offset_degrees\":%d,\"target_raw\":%d,\"command_complete\":%s,\"position_verified\":false,\"power\":\"off\"}\n",offset,target,completed?"true":"false");
  if(completed)centerOffsetDegrees=offset;
  return completed;
}

inline void networkSweep(const char* id, int degrees, bool centerMode, int offset) {
  static char lastId[9]="";
  if(!strlen(id)){if(abs(offset)<=15)centerOffsetDegrees=offset;return;}
  if(strlen(id)!=8||strspn(id,"0123456789abcdef")!=8||!strcmp(id,lastId))return;
  strcpy(lastId,id);
  bool allowed=!audioStage&&!cameraBusReleased&&abs(offset)<=15&&(centerMode||(degrees>=5&&degrees<=30));
  bool completed=false;
  if(allowed){
    if(centerMode)completed=adjustCenter(offset);
    else{centerOffsetDegrees=offset;supervisedYawSweep(degrees);completed=sweepCompleted;}
  }
  NetworkAck report{};
  snprintf(report.text,sizeof(report.text),"{\"type\":\"motor_result\",\"id\":\"%s\",\"status\":\"%s\",\"power\":\"off\",\"pitch_torque\":\"off\",\"motion_verified\":false,\"center_offset\":%d}",id,completed?"completed":"failed",centerOffsetDegrees);
  if(networkEnabled)xQueueSend(networkAudio,&report,pdMS_TO_TICKS(100));
}

inline bool prepareLights() {
  // Camera SCCB owns the same controller. Never interrupt it for decorative LEDs.
  if (cameraBusReleased) return false;
  if (!expanderReady && !powerExpander.begin()) return false;
  expanderReady = true;
  if (!powerExpander.setDirection(13, true)) return false;
  if (!powerExpander.setPullMode(13, m5::PY32IOExpander_Class::pull_up)) return false;
  powerExpander.setDriveMode(13, false);
  powerExpander.setLedCount(12);
  return true;
}

inline bool setBodyLights(uint8_t red, uint8_t green, uint8_t blue) {
  HardwareGuard guard;
  if (!prepareLights()) return false;
  for (uint8_t index = 0; index < 12; ++index) powerExpander.setLedColor(index, red, green, blue);
  powerExpander.refreshLeds();
  return true;
}

inline void invalidateLights() { expanderReady = false; }

inline bool handleCommand(const String& command) {
  if (!command.startsWith("M|")) return false;
  if (command == "M|off") {
    bool ready = prepareInterface();
    powerOff();
    Serial.printf("{\"type\":\"motor_safety\",\"op\":\"off\",\"ok\":%s,\"power\":\"off\"}\n", ready ? "true" : "false");
  } else if (command == "M|probe") {
    probe();
  } else if (command == "M|raw") {
    rawProbe();
  } else if (command == "M|yaw|-3") {
    moveYawTo(baselineYaw - kYawTestSteps, "yaw_minus_3deg");
  } else if (command == "M|yaw|+3") {
    moveYawTo(baselineYaw + kYawTestSteps, "yaw_plus_3deg");
  } else if (command == "M|yaw|home") {
    moveYawTo(baselineYaw, "yaw_home");
  } else if (command == "M|yaw|open-loop-3") {
    openLoopYawSafetyTest();
  } else if (command == "M|yaw|open-loop-6") {
    openLoopYawSafetyTest(20);
  } else if (command == "M|yaw|sweep-15") {
    if (audioStage) reportFailure("yaw_sweep_15deg", "audio_busy");
    else supervisedYawSweep(15);
  } else if (command == "M|yaw|sweep-30") {
    if (audioStage) reportFailure("yaw_sweep_30deg", "audio_busy");
    else supervisedYawSweep(30);
  } else {
    reportFailure("command", "unsupported_command");
  }
  return true;
}

inline void service() {
  if (powerEnabled && millis() - powerEnabledAt >= kPowerTimeoutMs) {
    powerOff();
    Serial.println("{\"type\":\"motor_safety\",\"op\":\"timeout\",\"ok\":false,\"power\":\"off\"}");
  }
}

}  // namespace motor_safety
