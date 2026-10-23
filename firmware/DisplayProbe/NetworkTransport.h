#pragma once
#include <WiFi.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#if __has_include("network.dev.h")
#include "network.dev.h"
#define STACKCHAN_HTTP_DEV 1
#elif __has_include("network.local.h")
#include "network.local.h"
#else
#include "network.example.h"
#endif

struct NetworkFrame { char text[120]; bool camera; char audio[9]; int volume; bool speakerOnly; int outputGain; bool speech; };
struct NetworkAck { char text[300]; };
struct NetworkImage { uint8_t* data; size_t length; uint32_t captured; };
QueueHandle_t networkFrames = nullptr, networkAcks = nullptr;
QueueHandle_t networkImages = nullptr;
QueueHandle_t networkAudio = nullptr;
struct NetworkSpeech { uint8_t* data; size_t length; char id[9]; uint32_t captured; };
QueueHandle_t networkSpeech = nullptr;
bool networkEnabled = false;
bool networkHttpDev = false;
bool beginDeviceRequest(HTTPClient& request, NetworkClient& plain, NetworkClientSecure& secure, const String& url) {
  if (networkHttpDev) return request.begin(plain,url);
  secure.setCACert(STACKCHAN_ROOT_CA); secure.setHandshakeTimeout(5);
  return request.begin(secure,url);
}

void networkTask(void*) {
  WiFi.setHostname("atk-stackchan");
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(STACKCHAN_WIFI_SSID,STACKCHAN_WIFI_PASSWORD);
  configTime(0,0,STACKCHAN_NTP_SERVER);
  String base(STACKCHAN_SERVER_URL);
  while (base.endsWith("/")) base.remove(base.length()-1);
  uint32_t lastPoll = millis()-2000, lastReconnect = millis();
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      if (millis()-lastReconnect > 30000) { lastReconnect = millis(); WiFi.reconnect(); }
      vTaskDelay(pdMS_TO_TICKS(200)); continue;
    }
    // A trustworthy clock is needed for X.509 certificate validity checks.
    if (!networkHttpDev && time(nullptr) < 1700000000) { vTaskDelay(pdMS_TO_TICKS(200)); continue; }
    if (millis()-lastPoll >= 2000) {
      lastPoll = millis();
      NetworkClient plain; NetworkClientSecure client;
      HTTPClient request; request.setConnectTimeout(3000); request.setTimeout(3000);
      request.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
      if (beginDeviceRequest(request,plain,client,base+"/api/device/frame")) {
        const char* headers[] = {"X-StackChan-Camera","X-StackChan-Audio","X-StackChan-Volume","X-StackChan-Audio-Mode","X-StackChan-Output-Gain"}; request.collectHeaders(headers,5);
        request.addHeader("Authorization",String("Bearer ")+STACKCHAN_DEVICE_TOKEN);
        if (request.GET() == 200) {
          String text = request.getString(); text.trim();
          if (text.startsWith("S|") && text.length() < sizeof(NetworkFrame::text)) {
            NetworkFrame incoming{}; text.toCharArray(incoming.text,sizeof(incoming.text));
            incoming.camera = request.header("X-StackChan-Camera") == "1";
            request.header("X-StackChan-Audio").toCharArray(incoming.audio,sizeof(incoming.audio));
            incoming.volume=request.header("X-StackChan-Volume").toInt();
            incoming.speakerOnly=request.header("X-StackChan-Audio-Mode")=="speaker";
            incoming.speech=request.header("X-StackChan-Audio-Mode")=="speech";
            incoming.outputGain=request.header("X-StackChan-Output-Gain").toInt();
            xQueueOverwrite(networkFrames,&incoming);
          }
        }
        request.end();
      }
    }
    NetworkAck audio{};
    if (xQueueReceive(networkAudio,&audio,0) == pdTRUE) {
      NetworkClient plain; NetworkClientSecure client; HTTPClient request;
      request.setConnectTimeout(2000); request.setTimeout(3000);
      request.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
      if (beginDeviceRequest(request,plain,client,base+"/api/device/audio")) {
        request.addHeader("Authorization",String("Bearer ")+STACKCHAN_DEVICE_TOKEN);
        request.addHeader("Content-Type","application/json"); request.POST(String(audio.text)); request.end();
      }
    }
    NetworkSpeech speech{};
    if(xQueueReceive(networkSpeech,&speech,0)==pdTRUE) {
      if(millis()-speech.captured<15000) {
        NetworkClient plain; NetworkClientSecure client; HTTPClient request;
        request.setConnectTimeout(2000);request.setTimeout(5000);request.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
        if(beginDeviceRequest(request,plain,client,base+"/api/device/speech")) {
          request.addHeader("Authorization",String("Bearer ")+STACKCHAN_DEVICE_TOKEN);
          request.addHeader("Content-Type","application/octet-stream");request.addHeader("X-StackChan-Audio-Id",speech.id);
          request.POST(speech.data,speech.length);request.end();
        }
      }
      free(speech.data);
    }
    NetworkImage image{};
    if (xQueueReceive(networkImages,&image,0) == pdTRUE) {
      if (millis()-image.captured < 5000) {
        NetworkClient plain; NetworkClientSecure client;
        HTTPClient request; request.setConnectTimeout(2000); request.setTimeout(3000);
        request.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
        if (beginDeviceRequest(request,plain,client,base+"/api/device/camera")) {
          request.addHeader("Authorization",String("Bearer ")+STACKCHAN_DEVICE_TOKEN);
          request.addHeader("Content-Type","image/jpeg");
          request.POST(image.data,image.length); request.end();
        }
      }
      free(image.data);
    }
    NetworkAck ack{};
    if (xQueueReceive(networkAcks,&ack,0) == pdTRUE) {
      NetworkClient plain; NetworkClientSecure client;
      HTTPClient request; request.setConnectTimeout(3000); request.setTimeout(3000);
      request.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
      if (beginDeviceRequest(request,plain,client,base+"/api/device/ack")) {
        request.addHeader("Authorization",String("Bearer ")+STACKCHAN_DEVICE_TOKEN);
        request.addHeader("Content-Type","application/json");
        request.POST(String(ack.text)); request.end();
      }
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

void startNetwork() {
  if (!strlen(STACKCHAN_WIFI_SSID)) return;
  String url(STACKCHAN_SERVER_URL);
#ifdef STACKCHAN_HTTP_DEV
  String host = url.substring(7); int end = host.indexOf(':'); if (end >= 0) host = host.substring(0,end);
  IPAddress address;
  networkHttpDev = url.startsWith("http://") && address.fromString(host) && (address[0] == 10 || (address[0] == 192 && address[1] == 168) || (address[0] == 172 && address[1] >= 16 && address[1] <= 31));
#endif
  if ((!networkHttpDev && (!url.startsWith("https://") || !strlen(STACKCHAN_ROOT_CA))) || url.indexOf("localhost") >= 0 || url.indexOf("127.0.0.1") >= 0 || strlen(STACKCHAN_DEVICE_TOKEN) < 32) {
    Serial.println("Network config incomplete; USB mode retained"); return;
  }
  networkFrames = xQueueCreate(1,sizeof(NetworkFrame));
  networkAcks = xQueueCreate(1,sizeof(NetworkAck));
  networkImages = xQueueCreate(1,sizeof(NetworkImage));
  networkAudio = xQueueCreate(1,sizeof(NetworkAck));
  networkSpeech = xQueueCreate(1,sizeof(NetworkSpeech));
  if (!networkFrames || !networkAcks || !networkImages || !networkAudio || !networkSpeech) {
    if (networkFrames) vQueueDelete(networkFrames);
    if (networkAcks) vQueueDelete(networkAcks);
    if (networkImages) vQueueDelete(networkImages);
    if (networkAudio) vQueueDelete(networkAudio);
    if (networkSpeech) vQueueDelete(networkSpeech);
    networkFrames = nullptr; networkAcks = nullptr; return;
  }
  networkEnabled = true;
  if (xTaskCreate(networkTask,"stackchan-network",12288,nullptr,1,nullptr) != pdPASS) {
    networkEnabled = false;
    vQueueDelete(networkFrames); vQueueDelete(networkAcks);
    vQueueDelete(networkImages);
    vQueueDelete(networkAudio);
    vQueueDelete(networkSpeech);
    networkFrames = nullptr; networkAcks = nullptr;
  }
}
