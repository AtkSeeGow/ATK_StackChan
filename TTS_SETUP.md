# StackChan 語音服務：合成與裝置播放

## 2026-10-28 取消30秒音訊限制（原始碼完成、韌體未部署）

依使用者要求取消固定30秒音訊上限，保留合成等待180秒（R2推論總期限165秒）與200字輸入。語音adapter／worker／API／Windows合成／控制站／韌體的PCM檢查統一改為4MiB記憶體預算，這是容量保護，17kHz mono int16約123.36秒；尚非無限長串流。裝置實際可用PSRAM不足仍回allocation_failed，不裁切音訊。控制站播放等待依實際音長加30秒且至少60秒；韌體依音長加5秒，長度乘法改uint64_t避免超過約126秒時32位溢位。韌體下載期限10→30秒，角色stdio行長擴大以容納PCM。超出記憶體預算回422並明確提示容量不足，不停止正常worker或改聲線。

Node37/37與Python7/7通過，包含API與adapter接受40秒合成PCM、長播放狀態與超容量拒絕。真實GPU固定176字合成測試成功：6段、81.30秒完成、音訊37.84秒、last_engine=qwen3-local、fallback_count=0；PCM僅記憶體、未播放或落盤，測試worker已關閉。未驗證裝置長音訊聽感與下載。當前AI語音站checkout沒有.tools/arduino-cli、Arduino核心／函式庫，wsl亦未提供可用Linux建置環境；未編譯或刷寫，不能宣稱裝置已支援長音訊。控制站需依既有工具鏈編譯並只刷應用槽0x20000，保留分割表及備份，再驗收長音訊下載／播放與播放後收音。正式服務未重啟。


**AI 語音站**負責合成，**控制站**負責排程、快取與裝置傳輸；名稱對照見 [SERVICE_MAP.md](SERVICE_MAP.md)。下方歷史 `.100` 指 AI 語音站，`.199` 指控制站。

## 2026-10-28 長句與回退恢復調整

角色合成改為依標點分段，每段最多32字，依序使用同一個 R2 worker 合成並在記憶體合併；沿用已接受的聲線與生成參數。每段最多60秒、R2整筆等待最多165秒，預留Windows備援8秒與回傳時間；控制站 HTTP 等待及合成狀態期限均為180秒（使用者指定上限）。輸入仍限200字，裝置單段音訊仍限30秒；合併超過30秒回HTTP422並提示縮短文字，不改用 Windows 偷換聲線，也不停止正常 worker。

推論失敗／逾時會丟棄整筆部分結果，使用 Windows 備援，隨後背景重載 R2；恢復期間請求使用備援，不等待模型載入。恢復失敗後至少60秒才由後續失敗請求再觸發重載，避免反覆載入。health 新增 recovering、last_fallback_reason（固定原因碼，不含文字或內部錯誤）、last_chunks。last_fallback_reason 保留最近回退原因，即使後續R2成功也不清除；實際上一筆引擎以last_engine為準。以下舊36秒與需手動重啟的敘述為歷史，以上述行為為準。兩站均需重啟載入新版，控制站涉及等待期限，不需刷韌體。

## 2026-10-26 現況與主機責任

.100 執行 Ollama（11434）、speech API（8001）、CUDA/small STT 與 R2 GPU 常駐 worker；Windows Hanhan CPU TTS 為失敗／逾時備援。.199 執行網頁、計時、裝置連線及語音預備排程／PCM 記憶體快取，裝置負責播放，不搬移兩台主機服務。R2 聲線、中文清晰度與音量已由使用者接受，不需重選。完整分工及驗收表以 [HANDOFF_5070.md](HANDOFF_5070.md) 最新節為準；本次未重新檢查 .100 程序。

.100 日常以 repo 根目錄的 `.\services\speech\start.ps1 -Device cuda -TtsEngine character` 啟動，沿用私有配對設定；無參數預設是 Windows 模式。已有8001服務時勿再啟動同埠程序。主機開機自動啟動／異常恢復尚未完成。

待驗收：各事件預備語音的延遲與階段台詞、播放後不重設直接真人 STT、連續多輪與 Ollama 共存負載、長句／中斷／回退恢復。下方「待部署／待試聽」依日期保留為歷史，不能解讀為目前尚未部署 R2。真人收音與相機仍僅記憶體處理。

## 整合互動與音訊恢復候選（2026-10-25）

- .199 已部署第一版共同互動狀態與整合網頁：STT 入口及播放最新 AI 回覆位於對話卡，辨識結果只帶入輸入框、仍需人工確認傳送；任意文字朗讀降為進階功能。
- 計時角色台詞與 AI 回覆自動朗讀是兩個獨立 opt-in；使用者已啟用計時角色台詞。計時事件由本機 Ollama 參考事件、階段、今日輪數、在席、台北時段及最近四句動態產生，再由 R2 播放；不具真實天氣資料時禁止假裝知道天氣，模型失敗才使用固定備援。角色表情、台詞與語音來源會一起更新；互動狀態會阻擋 STT、TTS、相機或音訊測試互搶資源。
- 已真實完成一次動態「開始專注」台詞：非固定文字、teasing 表情、裝置播放 completed、5.52 秒音訊，health `last_engine=qwen3-local`、`fallback_count=0`；計時未因產生或合成而停止。動態台詞不加入持久對話歷史。
- `resume` 已和首次 `start` 分開：模型上下文明確描述為同一段暫停後繼續，且輸出須含回來／繼續／接著等恢復語意，否則改用「回來了？那就接著把這一段做完吧。」等階段相符備援。新版主機已部署，仍待使用者下一次實際暫停／繼續聽感確認。
- 韌體候選修正會在音訊工作結束時明確釋放 speaker／mic／PSRAM、恢復 I2C 與預設狀態，並以 sync ACK 的可選 `audio_ready` 告知主機是否可接受下一個音訊工作。主機保留舊韌體相容性，新版回報 false 時禁止開始下一段語音。
- 先前只含音訊恢復的候選已由動畫版取代。使用者明確同意後，動畫版 app binary 1,347,664 bytes、SHA256 `e5f4b20c8db8c8517d6298af6ad6a379bf6fb3880d4da2d89f3aefdf3199250d` 已只刷 0x20000；write hash 與獨立 verify-flash digest 均通過，未動其他分割區或馬達。
- 新版已恢復 Wi-Fi ACK、`audioReady:true`，進行中 timer 同步檢查通過。純螢幕動畫包含待機眨眼、happy 輕跳、teasing 眨眼、concerned 眉眼、TTS 嘴型、提示音與收音聆聽動畫；動畫 redraw 不增加語意 `render_count`。使用者確認動畫可見，但效果不明顯；本輪先保留，若續作需加強幅度與辨識度。仍需重做 R2 播放後不重設的真人五秒 STT，不能以刷寫或 telemetry 成功代替實機修復。
- Node 18 項測試通過；本輪未修改 .100 speech service，.199 也沒有可用 Python，因此未重跑 Python mock。

## .199 R2 裝置驗收更新（2026-10-25）

- .199 使用既有 `tools/check-synthesis.mjs` 跨主機呼叫通過：17000 Hz／mono／16-bit raw PCM、3.04 秒、peak 15001，音訊未落盤；端到端等待約 39 秒。
- .100 health 在請求後回報 R2 `qwen3-local`、CUDA、worker ready、`last_engine=qwen3-local`、`fallback_count=0`，確認沒有誤把 Hanhan 回退當成新聲線成功。
- 使用者由 .199 網頁手動播放短句、得意與關心台詞，確認中文清楚，對角色感與音量表示很滿意；按下後約 5～10 秒出聲。裝置 Wi-Fi ACK 與播放完成狀態正常，音量 208／加強輸出。
- 播放後真人五秒 STT 回歸最初連續兩次失敗：裝置 Wi-Fi ACK 仍持續，但沒有回報提示音／recording／完成，也沒有 PCM 上傳至 .199，約 30 秒後顯示「裝置錄音未送達」。短按裝置 RST 並等 Wi-Fi 恢復後，由使用者知情並手動再試，.199 的 speech／audio 均 completed、取得非空辨識結果，.100 health 仍為 CUDA/small；使用者確認文字正確，按下收音後約 5～10 秒產出結果。未保存錄音或逐字稿。這表示基本 STT 回歸在重設後通過，但 TTS 播放後音訊狀態無法自行恢復仍是待修問題。

## .100 角色 TTS（2026-10-24 最新）

使用者初步接受 R2 角色聲線，現已在 .100 接入相同 `/synthesize`；.199 程式及韌體不需變更。現有 speech venv 不安裝 Qwen 套件，獨立常駐 worker 使用 `.tools/voice-design/.venv`，啟動時載入固定 Base 權重與合成 R2 參考特徵。推論與動態 PCM 僅留記憶體，不保存或記錄輸入文字。只有先前固定合成試聽素材存在 `.tools/`。

啟動角色模式（repo 根目錄）：

```powershell
.\services\speech\start.ps1 -TtsEngine character
```

原本 Windows 模式仍是腳本預設；回復時先停止目前這個語音服務，再以 `.\services\speech\start.ps1 -TtsEngine windows` 啟動，保留既有設定與金鑰。不要在同一埠並行啟動兩份。`character` 啟動會先等待 worker 就緒（最多 180 秒），失敗則以 Hanhan 提供服務；不是等待 HTTP 請求時才冷載入。

角色請求共用原本 STT 忙碌鎖，36 秒內未取得有效 PCM 便終止 worker 並嘗試 Hanhan（8 秒期限）。角色程序失敗後保持 Windows 回退，避免每句重新載入造成持續逾時；恢復角色模式需在無進行中請求時重啟服務。回退也失敗時，回通用 HTTP 錯誤，不暴露文字／內部例外。未新增 .199 的控制接口，未自動播放。

`/health` 的 `tts.engine`／`tts.device` 表示目前可用引擎；`configured_engine` 為 qwen3-local，`voice` 為 R2，`ready` 是角色 worker 是否存活。`last_engine` 表示上一筆實際完成所用引擎，`fallback_count` 記錄本次服務程序的回退次數。不以 ready 單獨宣稱 GPU 推論或聽感通過。

本輪實測：真實 API 完整句 13.68 秒音訊／29.50 秒合成，短句 7.68 秒／15.81 秒；headers、17000 Hz／mono／16-bit little-endian 原始 PCM、非靜音及長度通過，未啟用回退。以其中五秒合成語音測 CUDA/small STT，HTTP 成功並返回非空辨識，約 13.60 秒；這不是裝置或真人收音驗收。另以獨立未啟動角色 worker 的 adapter 驗證真實 Hanhan 回退，3.29 秒音訊／0.45 秒合成，不影響執行中的角色服務。

加速效果：常駐模型／參考特徵避免每句冷啟動；設為四個 CPU 執行緒後，完整句與原試聽 29.48 秒相比沒有明顯推論加速，不宣稱達到即時。未使用改變已接受聲線的解碼設定或擅自縮短輸出；.199 現有 50 秒合成逾時維持，長句仍可能回退／失敗。角色與 STT 模型共存及順序推論已測；Ollama 模型同時 GPU 推論、長句、長時間負載與新聲線裝置播放仍待測。

依賴版本、模型 revision／參考 SHA256 與素材位置見 `VOICE_REFERENCE_SPEC.md`、worker 原始碼及 `.tools/voice-design/requirements-resolved.txt`。這些模型、venv 與合成參考不隨 Git，下一台不能只拉原始碼便假定可用。固定合成 API 檢查：`services/speech/.venv/Scripts/python.exe tools/check-character-api.py`（不播放、不錄音、不存音訊，輸出 metadata 至 `.tools/voice-design/api-validation.json`）。

本次程式測試：Node 14 項、Python 5 項通過；Python 新增 worker 啟動／私有 token 隔離、錯誤與逾時回退、health metadata 及 STT／TTS 忙碌互斥測試。這些 mock 測試與上方真實模型測試分開記錄。

更新：2026-10-24。**.199 已編譯並刷入，使用者確認裝置中文清楚、音量可接受，基本播放驗收通過。** 接手先讀 `AGENTS.md`、`HANDOFF_5070.md`、本文件；刷寫前讀 `HARDWARE_STATUS.md`。

最新實測：應用 1,346,144 bytes，僅寫入 0x20000、hash 校驗通過；兩次固定短句播放皆完成，約 2.55 秒收到播放回報、6.12 秒流程完成，Wi-Fi ACK 持續。再次播放使用新 ID，舊 ID 下載 HTTP 409；播放後相機可恢復，檢查後停止。14 項 Node、2 項 Python 測試通過。新韌體播放後的真人 STT 回歸、長句、弱網路及實際失聯仍待驗證。下方「尚未編譯」等描述保留為原始交接時狀態，最新驗收以本段及 HANDOFF_5070.md 為準。

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
