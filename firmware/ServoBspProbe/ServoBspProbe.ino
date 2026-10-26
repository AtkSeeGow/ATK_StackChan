#include <M5Unified.h>
#include <M5StackChan.h>
#include <drivers/FTServo_Arduino/src/SCSCL.h>
#include <drivers/PY32IOExpander/PY32IOExpander.hpp>

namespace {
constexpr uint8_t kPowerPin = 0;
constexpr uint8_t kYawId = 1;
constexpr uint8_t kPitchId = 2;

m5::PY32IOExpander_Class powerExpander;
SCSCL servoBus;
String command;

void setPowerOff(bool uartReady) {
  if (uartReady) {
    servoBus.EnableTorque(kYawId, 0);
    servoBus.EnableTorque(kPitchId, 0);
    delay(20);
    servoBus.end();
  }
  powerExpander.digitalWrite(kPowerPin, false);
}

void runProbe() {
  // Delay the board/BSP initialization until an explicit probe command.  This
  // keeps USB available even when comparing older Arduino cores against the
  // currently installed M5Unified library.
  M5.begin();

  // Reproduce the public StackChan BSP order without calling Motion.init(),
  // which could write calibration defaults or start its motion task.
  M5StackChan.TouchSensor.begin();

  bool expanderReady = false;
  uint32_t startedAt = millis();
  while (millis() - startedAt <= 1200) {
    delay(200);
    if (powerExpander.begin()) {
      expanderReady = true;
      break;
    }
  }
  if (!expanderReady ||
      !powerExpander.setDirection(kPowerPin, true) ||
      !powerExpander.setPullMode(kPowerPin, m5::PY32IOExpander_Class::pull_up) ||
      !powerExpander.digitalWrite(kPowerPin, true)) {
    powerExpander.digitalWrite(kPowerPin, false);
    Serial.println("{\"type\":\"motor_safety\",\"op\":\"bsp_probe\",\"ok\":false,\"reason\":\"io_expander_unavailable\",\"power\":\"off\"}");
    return;
  }

  delay(200);
  bool uartReady = servoBus.begin(UART_NUM_1, 1000000, 6, 7);
  if (!uartReady) {
    setPowerOff(false);
    Serial.println("{\"type\":\"motor_safety\",\"op\":\"bsp_probe\",\"ok\":false,\"reason\":\"uart_start_failed\",\"power\":\"off\"}");
    return;
  }

  int yawTorqueOffAck = servoBus.EnableTorque(kYawId, 0);
  int pitchTorqueOffAck = servoBus.EnableTorque(kPitchId, 0);
  int yawPing = servoBus.Ping(kYawId);
  int pitchPing = servoBus.Ping(kPitchId);
  int yawRaw = servoBus.ReadPos(kYawId);
  int pitchRaw = servoBus.ReadPos(kPitchId);
  setPowerOff(true);

  bool valid = yawPing == kYawId && pitchPing == kPitchId &&
               yawRaw >= 0 && yawRaw <= 1000 && pitchRaw >= 0 && pitchRaw <= 1000;
  Serial.printf("{\"type\":\"motor_safety\",\"op\":\"bsp_probe\",\"ok\":%s,\"yaw_ping\":%d,\"pitch_ping\":%d,\"yaw_torque_off_ack\":%d,\"pitch_torque_off_ack\":%d,\"yaw_raw\":%d,\"pitch_raw\":%d,\"power\":\"off\"}\n",
                valid ? "true" : "false", yawPing, pitchPing, yawTorqueOffAck,
                pitchTorqueOffAck, yawRaw, pitchRaw);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  command.reserve(32);
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      if (command == "M|raw") runProbe();
      if (command == "M|off") {
        Serial.println("{\"type\":\"motor_safety\",\"op\":\"off\",\"ok\":true,\"power\":\"off\"}");
      }
      command = "";
    } else if (c != '\r' && command.length() < 31) {
      command += c;
    }
  }
  delay(5);
}
