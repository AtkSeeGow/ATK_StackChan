#pragma once
#include <math.h>
char lastAudioId[9] = "";
int audioStage = 0;
uint32_t audioAt = 0;
int16_t* audioSamples = nullptr;
constexpr uint32_t audioRate = 17000; // same rate as the official recording example
constexpr size_t audioCount = audioRate*2; // two seconds, mono
size_t audioLength=audioCount;
bool speechCapture=false;
uint32_t audioTimeoutMs=7000;
int audioPeak = 0; double audioRms = 0;
int audioVolume = 208;
int audioOutputGain = 4;
int ampVolume=-1, ampSystem=-1, ampI2s=-1, ampBoost=-1;
int readAmp(uint8_t reg) {
  uint8_t bytes[2];
  return M5.In_I2C.readRegister(0x36,reg,bytes,2,400000) ? (bytes[0]<<8)|bytes[1] : -1;
}
bool beginAudioOutput() {
  if(!M5.Speaker.begin()) return false;
  ampVolume=readAmp(0x0C); ampSystem=readAmp(0x04); ampI2s=readAmp(0x06); ampBoost=readAmp(0x61);
  return true;
}
void audioReport(const char* status) {
  NetworkAck report{};
  snprintf(report.text,sizeof(report.text),"{\"id\":\"%s\",\"status\":\"%s\",\"peak\":%d,\"rms\":%.2f,\"amp\":{\"volume\":%d,\"system\":%d,\"i2s\":%d,\"boost\":%d,\"magnification\":%d,\"channel\":%d}}",lastAudioId,status,audioPeak,audioRms,ampVolume,ampSystem,ampI2s,ampBoost,M5.Speaker.config().magnification,M5.Speaker.getChannelVolume(0));
  Serial.println(report.text);
  if(networkEnabled) xQueueOverwrite(networkAudio,&report);
}
void finishAudio(const char* result) {
  M5.Mic.end(); M5.Speaker.end(); free(audioSamples); audioSamples=nullptr;
  // Return shared audio resources to a known idle state before another TTS or
  // STT session. Long downloaded speech must not leave the next capture stuck.
  if(cameraBusReleased) { M5.In_I2C.begin(); cameraBusReleased=false; }
  audioStage=0; speechCapture=false; audioLength=audioCount; audioTimeoutMs=7000;
  delay(20); audioReport(result);
}
bool audioSubsystemReady() { return audioStage==0 && audioSamples==nullptr && !M5.Speaker.isPlaying() && !M5.Mic.isRecording(); }
void startAudio(const char* id, int volume, bool speakerOnly, int outputGain, bool speech) {
  if(strlen(id)!=8 || strspn(id,"0123456789abcdef")!=8 || !strcmp(lastAudioId,id) || audioStage) return;
  strcpy(lastAudioId,id); audioPeak=0; audioRms=0;
  ampVolume=ampSystem=ampI2s=ampBoost=-1;
  audioVolume=constrain(volume,32,255);
  audioOutputGain=outputGain==8 ? 8 : 4;
  speechCapture=speech; audioLength=speech ? audioRate*5 : audioCount;
  audioTimeoutMs=7000;
  cameraControl("C|0");
  if(cameraBusReleased) { M5.In_I2C.begin(); cameraBusReleased=false; }
  audioSamples=(int16_t*)ps_malloc(audioLength*sizeof(int16_t));
  if(!audioSamples) { finishAudio("allocation_failed"); return; }
  M5.Mic.end(); M5.Speaker.setVolume(64);
  auto speakerCfg=M5.Speaker.config(); speakerCfg.task_priority=5; speakerCfg.dma_buf_count=16; speakerCfg.magnification=audioOutputGain; M5.Speaker.config(speakerCfg);
  auto micCfg=M5.Mic.config(); micCfg.sample_rate=audioRate; micCfg.task_priority=5; micCfg.dma_buf_count=16; M5.Mic.config(micCfg);
  if(speakerOnly) {
    double sum=0;
    for(size_t i=0;i<audioCount;i++) {
      float t=(float)i/audioRate, local=0, amplitude=0;
      if(t<0.6f) { amplitude=6000; local=t; }
      else if(t>=0.8f && t<1.4f) { amplitude=12000; local=t-0.8f; }
      float fade=amplitude ? min(1.0f,min(local/0.01f,(0.6f-local)/0.01f)) : 0;
      int sample=(int)(amplitude*fade*sinf(2*3.14159265f*660*t));
      audioSamples[i]=sample; audioPeak=max(audioPeak,abs(sample)); sum+=(double)sample*sample;
    }
    audioRms=sqrt(sum/audioCount); M5.Speaker.setVolume(audioVolume);
    if(!beginAudioOutput() || !M5.Speaker.playRaw(audioSamples,audioCount,audioRate,false)) { finishAudio("playback_failed"); return; }
    audioStage=3; audioAt=millis(); audioReport("playback"); return;
  }
  if(!beginAudioOutput() || !M5.Speaker.tone(880,200)) { finishAudio("speaker_failed"); return; }
  audioAt=millis(); audioStage=1; audioReport("tone");
}
void serviceAudio() {
  if(networkEnabled && !audioStage) {
    NetworkPlayback playback{};
    if(xQueueReceive(networkPlayback,&playback,0)==pdTRUE) {
      if(!strcmp(lastAudioId,playback.id)) {free(playback.data);return;}
      strcpy(lastAudioId,playback.id);audioPeak=0;audioRms=0;
      ampVolume=ampSystem=ampI2s=ampBoost=-1;
      if(!playback.data || !playback.length || playback.length>4194304 || playback.length%2 || millis()-playback.received>5000) {free(playback.data);audioReport("download_failed");return;}
      cameraControl("C|0");
      if(cameraBusReleased) {M5.In_I2C.begin();cameraBusReleased=false;}
      M5.Mic.end();M5.Speaker.end();
      audioSamples=(int16_t*)playback.data;audioLength=playback.length/2;
      audioVolume=playback.volume;audioOutputGain=playback.outputGain;
      auto cfg=M5.Speaker.config();cfg.task_priority=5;cfg.dma_buf_count=16;cfg.magnification=audioOutputGain;M5.Speaker.config(cfg);
      M5.Speaker.setVolume(audioVolume);
      if(!beginAudioOutput() || !M5.Speaker.playRaw(audioSamples,audioLength,audioRate,false)) {finishAudio("playback_failed");return;}
      audioStage=3;audioAt=millis();audioTimeoutMs=(uint32_t)((uint64_t)playback.length*1000/34000)+5000;
      audioReport("playback");
    }
  }
  if(!audioStage) return;
  if(millis()-audioAt>audioTimeoutMs) { finishAudio("timeout"); return; }
  if(audioStage==1 && millis()-audioAt>1000) {
    M5.Speaker.end();
    if(!M5.Mic.begin() || !M5.Mic.record(audioSamples,audioLength,audioRate,false)) { finishAudio("microphone_failed"); return; }
    audioStage=2; audioAt=millis(); audioReport("recording");
  } else if(audioStage==2 && !M5.Mic.isRecording()) {
    if(speechCapture) {
      M5.Mic.end();
      NetworkSpeech outgoing{(uint8_t*)audioSamples,audioLength*sizeof(int16_t),"",millis()};strcpy(outgoing.id,lastAudioId);
      if(xQueueSend(networkSpeech,&outgoing,0)!=pdTRUE) {finishAudio("upload_failed");return;}
      audioSamples=nullptr; finishAudio("completed");return;
    }
    M5.Mic.end(); double sum=0, dc=0;
    for(size_t i=0;i<audioCount;i++) dc+=audioSamples[i];
    dc/=audioCount;
    for(size_t i=0;i<audioCount;i++) { int sample=(int)audioSamples[i]-(int)dc; audioPeak=max(audioPeak,abs(sample)); sum+=(double)sample*sample; }
    audioRms=sqrt(sum/audioCount);
    // Bounded speech gain; do not amplify near-silence or clip strong peaks.
    float gain=1.0f;
    float ceiling=audioOutputGain==8 ? 14000.0f : 20000.0f;
    if(audioRms>80 && audioPeak>500) gain=min(4.0f,min(2500.0f/(float)audioRms,ceiling/audioPeak));
    else if(audioPeak>ceiling) gain=ceiling/audioPeak;
    for(size_t i=0;i<audioCount;i++) {
      float fade=min(1.0f,min(i/320.0f,(audioCount-1-i)/320.0f));
      int value=(int)((audioSamples[i]-dc)*gain*fade);
      audioSamples[i]=(int16_t)constrain(value,-30000,30000);
    }
    M5.Speaker.setVolume(audioVolume);
    if(!beginAudioOutput() || !M5.Speaker.playRaw(audioSamples,audioCount,audioRate,false)) { finishAudio("playback_failed"); return; }
    audioStage=3; audioAt=millis(); audioReport("playback");
  } else if(audioStage==3 && !M5.Speaker.isPlaying()) finishAudio("completed");
}
