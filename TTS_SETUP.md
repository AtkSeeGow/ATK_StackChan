# 本機語音合成與裝置播放

更新：2026-10-24。本階段原始碼與主機測試已完成，**新韌體尚未編譯、刷入或通過裝置聽感驗收**。接手先讀 `AGENTS.md`、`HANDOFF_5070.md`、本文件；刷寫前讀 `HARDWARE_STATUS.md`。

## 已完成範圍

- STT 的 GPU 實測與 .199 → .100 連線已通過；使用者確認裝置五秒中文辨識正確，收音結束後約 5～15 秒顯示結果（估計區間）。真人靜音、重試、失聯仍待補測。
- .100 已啟動語音服務，small/CUDA STT 保持使用 GPU。新增 TTS 使用本機 Windows Hanhan zh-TW、**CPU** 合成，沒有雲端請求。
- .100 的真實合成 API 回覆 HTTP 200，固定中文句產生 117186 bytes、約 3.447 秒音訊，耗時約 0.336 秒。只有資料格式與非靜音檢查，尚未評估音色或裝置聽感。
- Node 24.16.0：14 項測試通過；Python：2 項 mock API 測試通過。涵蓋金鑰、輸入限制、音訊格式與大小、過期／重複下載、播放狀態、音訊互斥與不自動傳送對話。這些測試不能代替 C++ 編譯與裝置播放。

## 架構與操作

1. 使用者在 .199 網頁「讓裝置說話」填入 1～200 字，按「合成並在裝置播放」。也可按「填入最新 AI 回覆」，確認後再手動播放；不自動播放對話。
2. .199 呼叫 .100 的 `POST /synthesize`，沿用既有 `STACKCHAN_STT_URL`／`STACKCHAN_STT_TOKEN`，不需新金鑰或新埠。
3. .100 只在記憶體生成 17 kHz、16-bit little-endian、單聲道 PCM，最長三十秒。Windows 語音引擎透過標準輸入接收純文字，不把使用者文字當 PowerShell 程式碼，也不使用 SSML。
4. .199 在 RAM 暫存音訊，限制大小與峰值，套用 10 ms 首尾淡入淡出；加強輸出峰值上限 14000、標準 20000，只衰減、不額外放大。
5. 裝置輪詢取得獨立的 `X-StackChan-Playback` 指令，再使用裝置金鑰下載 `/api/device/playback?id=...`，完整接收至 PSRAM 後才播放。不在裝置端等待合成模型。
6. 指令只供下載一次，等待下載超過十五秒失效；最多約 1.02 MB 音訊，下載讀取階段最多十秒。播放／下載總狀態六十秒逾時。失敗不自動重播，使用者重試產生新 ID。
7. 合成／播放期間阻擋另一次收音、硬體音訊測試與相機啟動；相機停止後需手動重新開啟並校準。不改計時、不初始化馬達。

舊韌體忽略新播放 header，最多顯示等待後逾時，**不會把 TTS 指令當成錄音指令**。請先更新裝置應用程式再作聽感驗收。合成文字與音訊均不寫入 SQLite 或音訊檔；既有對話保存規則維持原樣。

## .199 接手部署

使用者已確認 USB 仍在 .199 的 COM4，該主機有可用韌體建置環境。此次由 .100 交接原始碼，**不從 .100 遠端刷寫，也不搬移 Node／資料庫服務**。

1. 將交接包解壓到暫存位置，檢查檔案清單與 SHA256，再將同相對路徑檔案帶入 .199 專案。保留 .199 的 `.env`、`data/`、`.tools/`、`backups/`、韌體私有網路 header。若 .199 另有未交接修改，先比對合併，勿盲目覆蓋。
2. 在 .199 專案根目錄執行 `node --test`，再執行 `node tools/check-synthesis.mjs`。後者只用固定測試句，檢查 .199 → .100 合成 API，顯示格式、秒數與峰值；不保存、不播放音訊。預期 `connected:true`、rate=17000、channels=1、bits=16、peak>0。
3. 使用 .199 既有工具執行 `./tools/build-firmware.ps1`。沿用 M5Stack core、StackChan 版 M5Unified 及私有網路設定。**.100 沒有 Arduino 工具鏈，此次尚未編譯新 C++。** 先修正任何編譯錯誤、重新檢查測試，成功後記錄應用大小。建置腳本限制應用不得超過原廠 `0x4F0000` 槽。
4. 核對產生的 `firmware/DisplayProbe/partitions.csv` 及建置輸出沿用原廠配置；保留既有原廠完整備份與上一版可用應用 binary。
5. 在 COM4 使用 .199 已驗證的 esptool 與既有 ROM 刷寫方式，**只寫 `.tools/build/display-probe/DisplayProbe.ino.bin` 到 `0x20000`**。不得使用全片 erase、整合映像或 Arduino 一般上傳流程覆寫 bootloader／partition table／NVS／assets。刷入後核對 hash，並確認裝置退出下載模式、恢復 Wi-Fi ACK；必要時短按 RST。沒有要求任何 eFuse 或馬達操作。
6. 重啟 .199 既有 Node 程序，使其載入新的 `server.mjs`／`synthesis.mjs`，重新整理網頁。沿用原本 `.env`，不更換金鑰。安排在使用者可接受的時間重啟，避免影響正在進行的計時。

若新應用不穩定，使用保留的上一版可用應用以相同方式只回寫 `0x20000`，不動其他分割區。Node 也可回復更新前程式；資料庫與私有設定不需回復成空白。

## 裝置驗證與回報

- 首次用固定短句「你好，現在開始專注時間」，音量先沿用 208／加強。確認狀態依序合成、等待下載、下載／播放、完成，並由使用者確認中文清楚、音量與失真；完成狀態只表示程式流程完成。
- 記錄從按鈕到出聲的估計時間，播放過程的 Wi-Fi ACK 與計時顯示是否持續。下載在網路任務內執行，慢網路可能暫時延遲輪詢；長句與弱網路需實機驗證。
- 確認合成／播放不啟動麥克風，播放完成後可再次 STT 五秒中文；相機能手動恢復。
- 再測一次播放、新 ID 正常；重複下載舊 ID 回 409，不補播。
- 語音服務失聯、裝置離線／下載中斷、超長文字皆應顯示失敗或逾時，不自動錄音或重播。斷開服務前先確認沒有使用者正在處理的工作，測完恢復 .100 服務。
- 驗證完成後更新 `HANDOFF_5070.md`：編譯版本／應用大小、刷入 hash 與 Wi-Fi ACK、實際播放內容是否清楚、延遲、失敗重試與剩餘問題。勿記錄真人錄音或逐字稿。

## 服務 API

`POST /synthesize` 使用既有 Bearer 語音金鑰、Content-Type `application/json`、body `{"text":"..."}`；成功回 `application/octet-stream` 原始 PCM，headers：`X-Audio-Sample-Rate: 17000`、`X-Audio-Channels: 1`、`X-Audio-Bits: 16`。不可直接視為帶 WAV header 的音訊檔。

health 的 `device:cuda` 是 **STT** 設定；新增 `tts.device:cpu`／`tts.engine:windows-local`。`tts.enabled` 表示端點有掛載，不等於此環境的 Windows 語音引擎已通過呼叫，請使用 check-synthesis 實測。

實作依據：[Microsoft SpeechSynthesizer 記憶體音訊串流 API](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.setoutputtoaudiostream?view=netframework-4.8.1)。
