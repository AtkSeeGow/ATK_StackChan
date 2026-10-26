#pragma once
#include <WiFi.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <atomic>
#include <WebSocketsClient.h>
#if __has_include("network.dev.h")
#include "network.dev.h"
#define STACKCHAN_HTTP_DEV 1
#elif __has_include("network.local.h")
#include "network.local.h"
#else
#include "network.example.h"
#endif

struct NetworkFrame { char text[160]; bool camera; char audio[9]; int volume; bool speakerOnly; int outputGain; bool speech; char motorId[9]; int motorDegrees; bool motorCenterMode; int motorCenterOffset; bool realtimeOnly; int timerDegrees; char activityId[9]; };
struct NetworkAck { char text[384]; };
struct NetworkImage { uint8_t* data; size_t length; uint32_t captured; };
QueueHandle_t networkFrames = nullptr, networkAcks = nullptr;
QueueHandle_t realtimeAcks = nullptr;
QueueHandle_t touchCommands=nullptr,touchReplies=nullptr;
std::atomic<bool> realtimeConnected{false};
std::atomic<bool> realtimePollNow{false};
QueueHandle_t networkImages = nullptr;
QueueHandle_t networkAudio = nullptr;
struct NetworkSpeech { uint8_t* data; size_t length; char id[9]; uint32_t captured; };
QueueHandle_t networkSpeech = nullptr;
struct NetworkPlayback { uint8_t* data; size_t length; char id[9]; int volume; int outputGain; uint32_t received; };
QueueHandle_t networkPlayback = nullptr;
bool networkEnabled = false;
bool networkHttpDev = false;
bool beginDeviceRequest(HTTPClient& request, NetworkClient& plain, NetworkClientSecure& secure, const String& url) {
  if (networkHttpDev) return request.begin(plain,url);
  secure.setCACert(STACKCHAN_ROOT_CA); secure.setHandshakeTimeout(5);
  return request.begin(secure,url);
}

void realtimeTask(void*) {
  WebSocketsClient socket;
  String address(STACKCHAN_SERVER_URL);
  bool secure=address.startsWith("https://");
  address.remove(0,secure?8:7);
  int slash=address.indexOf('/');if(slash>=0)address=address.substring(0,slash);
  int colon=address.indexOf(':');
  uint16_t port=colon>=0?address.substring(colon+1).toInt():(secure?443:80);
  String host=colon>=0?address.substring(0,colon):address;
  // The library appends CRLF itself; a trailing blank line ends the HTTP
  // handshake early and the remaining headers become invalid WS frames.
  String authorization=String("Authorization: Bearer ")+STACKCHAN_DEVICE_TOKEN;
  socket.setExtraHeaders(authorization.c_str());
  socket.setReconnectInterval(2000);
  socket.enableHeartbeat(10000,3000,2);
  char lastPlaybackNotice[9]="";
  socket.onEvent([&](WStype_t type,uint8_t* payload,size_t length){
    if(type==WStype_CONNECTED){realtimeConnected=true;return;}
    if(type==WStype_DISCONNECTED){realtimeConnected=false;return;}
    if(type!=WStype_TEXT||length>300)return;
    String packet;packet.concat(reinterpret_cast<const char*>(payload),length);
    if(packet.startsWith("C|")){NetworkAck reply{};packet.toCharArray(reply.text,sizeof(reply.text));if(touchReplies)xQueueOverwrite(touchReplies,&reply);return;}
    int newline=packet.indexOf('\n');if(newline<0||newline>=159)return;
    NetworkFrame frame{};char mode,extra;
    char id[9]="",playbackId[9]="";
    int count=sscanf(packet.c_str()+newline+1,"B|%d|%d|%8[0-9a-f]|%c|%d|%8[0-9a-f]|%8[0-9a-f]%c",&frame.motorCenterOffset,&frame.timerDegrees,id,&mode,&frame.motorDegrees,playbackId,frame.activityId,&extra);
    if(count!=7||strlen(id)!=8||strlen(playbackId)!=8||strlen(frame.activityId)!=8||abs(frame.motorCenterOffset)>15||frame.timerDegrees<5||frame.timerDegrees>30||!strchr("cs",mode))return;
    if(strcmp(playbackId,"00000000")&&strcmp(playbackId,lastPlaybackNotice)){strcpy(lastPlaybackNotice,playbackId);realtimePollNow=true;}
    packet.substring(0,newline).toCharArray(frame.text,sizeof(frame.text));
    if(strcmp(id,"00000000"))strcpy(frame.motorId,id);
    frame.motorCenterMode=mode=='c';frame.realtimeOnly=true;
    xQueueOverwrite(networkFrames,&frame);
  });
  if(secure)socket.beginSslWithCA(host.c_str(),port,"/api/device/live",STACKCHAN_ROOT_CA);
  else socket.begin(host.c_str(),port,"/api/device/live");
  for(;;){
    if(WiFi.status()==WL_CONNECTED&&(networkHttpDev||time(nullptr)>1700000000))socket.loop();
    else realtimeConnected=false;
    NetworkAck ack{};
    if(realtimeConnected&&xQueueReceive(realtimeAcks,&ack,0)==pdTRUE)socket.sendTXT(ack.text);
    if(realtimeConnected&&touchCommands&&xQueueReceive(touchCommands,&ack,0)==pdTRUE)socket.sendTXT(ack.text);
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void networkTask(void*) {
  WiFi.setHostname("atk-stackchan");
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(STACKCHAN_WIFI_SSID,STACKCHAN_WIFI_PASSWORD);
  configTime(0,0,STACKCHAN_NTP_SERVER);
  String base(STACKCHAN_SERVER_URL);
  while (base.endsWith("/")) base.remove(base.length()-1);
  uint32_t lastPoll = millis()-2000, lastReconnect = millis();
  char lastPlaybackId[9]="";
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      if (millis()-lastReconnect > 30000) { lastReconnect = millis(); WiFi.reconnect(); }
      vTaskDelay(pdMS_TO_TICKS(200)); continue;
    }
    // A trustworthy clock is needed for X.509 certificate validity checks.
    if (!networkHttpDev && time(nullptr) < 1700000000) { vTaskDelay(pdMS_TO_TICKS(200)); continue; }
    if (millis()-lastPoll >= 2000 || realtimePollNow.exchange(false)) {
      lastPoll = millis();
      NetworkClient plain; NetworkClientSecure client;
      HTTPClient request; request.setConnectTimeout(3000); request.setTimeout(3000);
      request.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
      if (beginDeviceRequest(request,plain,client,base+"/api/device/frame")) {
        const char* headers[] = {"X-StackChan-Camera","X-StackChan-Audio","X-StackChan-Volume","X-StackChan-Audio-Mode","X-StackChan-Output-Gain","X-StackChan-Playback","X-StackChan-Playback-Volume","X-StackChan-Playback-Gain","X-StackChan-Motor","X-StackChan-Motor-Degrees","X-StackChan-Motor-Mode","X-StackChan-Motor-Center","X-StackChan-Timer-Degrees","X-StackChan-Activity"}; request.collectHeaders(headers,14);
        request.addHeader("Authorization",String("Bearer ")+STACKCHAN_DEVICE_TOKEN);
        if (request.GET() == 200) {
          String text = request.getString(); text.trim();
          if (text.startsWith("S|") && text.length() < sizeof(NetworkFrame::text)) {
            NetworkFrame incoming{}; text.toCharArray(incoming.text,sizeof(incoming.text));
            incoming.camera = request.header("X-StackChan-Camera") == "1";
            request.header("X-StackChan-Motor").toCharArray(incoming.motorId,sizeof(incoming.motorId));
            incoming.motorDegrees=request.header("X-StackChan-Motor-Degrees").toInt();
            incoming.motorCenterMode=request.header("X-StackChan-Motor-Mode")=="center";
            incoming.motorCenterOffset=request.header("X-StackChan-Motor-Center").toInt();
            incoming.timerDegrees=constrain(request.header("X-StackChan-Timer-Degrees").toInt(),5,30);
            request.header("X-StackChan-Activity").toCharArray(incoming.activityId,sizeof(incoming.activityId));
            request.header("X-StackChan-Audio").toCharArray(incoming.audio,sizeof(incoming.audio));
            incoming.volume=request.header("X-StackChan-Volume").toInt();
            incoming.speakerOnly=request.header("X-StackChan-Audio-Mode")=="speaker";
            incoming.speech=request.header("X-StackChan-Audio-Mode")=="speech";
            incoming.outputGain=request.header("X-StackChan-Output-Gain").toInt();
            xQueueOverwrite(networkFrames,&incoming);
            String playbackId=request.header("X-StackChan-Playback");
            if(playbackId.length()==8 && strspn(playbackId.c_str(),"0123456789abcdef")==8 && strcmp(lastPlaybackId,playbackId.c_str())) {
              NetworkPlayback playback{};
              playbackId.toCharArray(playback.id,sizeof(playback.id));
              strcpy(lastPlaybackId,playback.id); // Each id is attempted only once, including failed downloads.
              playback.volume=constrain(request.header("X-StackChan-Playback-Volume").toInt(),32,255);
              playback.outputGain=request.header("X-StackChan-Playback-Gain")=="4" ? 4 : 8;
              request.end();
              NetworkClient pcmPlain; NetworkClientSecure pcmSecure; HTTPClient download;
              download.setConnectTimeout(2000);download.setTimeout(5000);download.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
              if(beginDeviceRequest(download,pcmPlain,pcmSecure,base+"/api/device/playback?id="+playbackId)) {
                const char* pcmHeaders[]={"X-Audio-Sample-Rate"};download.collectHeaders(pcmHeaders,1);
                download.addHeader("Authorization",String("Bearer ")+STACKCHAN_DEVICE_TOKEN);
                int code=download.GET(), length=download.getSize();
                if(code==200 && download.header("X-Audio-Sample-Rate")=="17000" && length>0 && length<=1020000 && length%2==0) {
                  playback.data=(uint8_t*)ps_malloc(length);
                  if(playback.data) {
                    size_t received=0;uint32_t started=millis();auto* stream=download.getStreamPtr();
                    while(received<(size_t)length && millis()-started<10000) {
                      int available=stream->available();
                      if(available>0) {int read=stream->read(playback.data+received,min((size_t)available,(size_t)length-received));if(read>0)received+=read;else break;}
                      else if(!download.connected())break;
                      else vTaskDelay(pdMS_TO_TICKS(5));
                    }
                    if(received==(size_t)length)playback.length=received;
                    else {free(playback.data);playback.data=nullptr;}
                  }
                }
                download.end();
              }
              playback.received=millis();
              if(xQueueSend(networkPlayback,&playback,0)!=pdTRUE)free(playback.data);
            }
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
  realtimeAcks = xQueueCreate(1,sizeof(NetworkAck));
  touchCommands=xQueueCreate(1,sizeof(NetworkAck));touchReplies=xQueueCreate(1,sizeof(NetworkAck));
  networkImages = xQueueCreate(1,sizeof(NetworkImage));
  networkAudio = xQueueCreate(1,sizeof(NetworkAck));
  networkSpeech = xQueueCreate(1,sizeof(NetworkSpeech));
  networkPlayback = xQueueCreate(1,sizeof(NetworkPlayback));
  if (!networkFrames || !networkAcks || !networkImages || !networkAudio || !networkSpeech || !networkPlayback) {
    if (networkFrames) vQueueDelete(networkFrames);
    if (networkAcks) vQueueDelete(networkAcks);
    if (networkImages) vQueueDelete(networkImages);
    if (networkAudio) vQueueDelete(networkAudio);
    if (networkSpeech) vQueueDelete(networkSpeech);
    if (networkPlayback) vQueueDelete(networkPlayback);
    networkFrames = nullptr; networkAcks = nullptr; return;
  }
  networkEnabled = true;
  if (xTaskCreate(networkTask,"stackchan-network",12288,nullptr,1,nullptr) != pdPASS) {
    networkEnabled = false;
    vQueueDelete(networkFrames); vQueueDelete(networkAcks);
    vQueueDelete(networkImages);
    vQueueDelete(networkAudio);
    vQueueDelete(networkSpeech);
    vQueueDelete(networkPlayback);
    networkFrames = nullptr; networkAcks = nullptr;
  }
  if(networkEnabled&&realtimeAcks)xTaskCreate(realtimeTask,"stackchan-websocket",8192,nullptr,1,nullptr);
}
