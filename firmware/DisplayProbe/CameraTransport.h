#pragma once
#include <esp_camera.h>
#include <img_converters.h>
#include <mbedtls/base64.h>

bool cameraWanted = false, cameraReady = false, cameraBusReleased = false;
uint32_t lastCapture = 0, lastCameraCommand = 0;
void cameraControl(const String& command) {
  if (command == "C|1") { cameraWanted = true; lastCameraCommand = millis(); }
  if (command == "C|0") {
    cameraWanted = false;
    if (cameraReady) esp_camera_deinit();
    cameraReady = false;
  }
}
bool beginCamera() {
  camera_config_t cfg{};
  cfg.pin_pwdn = -1; cfg.pin_reset = -1; cfg.pin_xclk = -1;
  cfg.pin_sccb_sda = 12; cfg.pin_sccb_scl = 11;
  cfg.pin_d0 = 39; cfg.pin_d1 = 40; cfg.pin_d2 = 41; cfg.pin_d3 = 42;
  cfg.pin_d4 = 15; cfg.pin_d5 = 16; cfg.pin_d6 = 48; cfg.pin_d7 = 47;
  cfg.pin_vsync = 46; cfg.pin_href = 38; cfg.pin_pclk = 45;
  cfg.xclk_freq_hz = 20000000; cfg.ledc_timer = LEDC_TIMER_0; cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.pixel_format = PIXFORMAT_RGB565; cfg.frame_size = FRAMESIZE_QVGA;
  cfg.jpeg_quality = 0; cfg.fb_count = 2; cfg.fb_location = CAMERA_FB_IN_PSRAM;
  cfg.grab_mode = CAMERA_GRAB_LATEST; cfg.sccb_i2c_port = -1;
  // Official StackChan camera wiring: release M5's I2C controller for SCCB.
  M5.In_I2C.release(); cameraBusReleased = true;
  esp_err_t result = esp_camera_init(&cfg);
  if (result != ESP_OK) {
    Serial.printf("{\"type\":\"camera_status\",\"error\":\"Camera init failed: %d\"}\n",result);
    return false;
  }
  return true;
}
void serviceCamera() {
  if (cameraWanted && millis()-lastCameraCommand > 7000) { cameraControl("C|0"); return; }
  if (!cameraWanted || millis()-lastCapture < 2000) return;
  lastCapture = millis();
  if (!cameraReady) { cameraReady = beginCamera(); if (!cameraReady) return; }
  camera_fb_t* image = esp_camera_fb_get();
  if (!image) { Serial.println("{\"type\":\"camera_status\",\"error\":\"Capture failed\"}"); return; }
  uint8_t* jpeg = nullptr; size_t length = 0;
  bool encoded = fmt2jpg(image->buf,image->len,image->width,image->height,image->format,70,&jpeg,&length);
  esp_camera_fb_return(image);
  if (encoded && length > 0 && length <= 130000) {
    if (networkEnabled) {
      NetworkImage outgoing{jpeg,length,millis()};
      if (xQueueSend(networkImages,&outgoing,0) == pdTRUE) jpeg = nullptr;
      free(jpeg); return;
    }
    size_t capacity = ((length+2)/3)*4+1, written = 0;
    unsigned char* text = (unsigned char*)ps_malloc(capacity);
    if (text && mbedtls_base64_encode(text,capacity,&written,jpeg,length) == 0) {
      Serial.print("{\"type\":\"camera_frame\",\"jpeg\":\"");
      Serial.write(text,written); Serial.println("\"}");
    }
    free(text);
  }
  free(jpeg);
}
