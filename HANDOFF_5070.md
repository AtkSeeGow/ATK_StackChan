# 5070 主機接手紀錄

更新：2026-10-24。接手時先核對此文件，再讀 `SPEECH_SETUP.md`／`TTS_SETUP.md`。GPU STT 與裝置五秒中文基本端到端驗收已通過；.199 已編譯刷入 TTS 韌體，使用者確認裝置中文清楚、音量可接受。下方較早的「未部署」描述為歷史紀錄，以最新實測節為準。

## .199 TTS 編譯、刷入與基本播放驗收（2026-10-24）

**目前下一階段：**使用者不滿意 Hanhan 音色，希望更接近俏皮、愛逞強的角色聲線，決定交給 .100 接續。先讀 `VOICE_STYLE_HANDOFF.md`，在 .100 本機評估並試聽，選定後再接入。播放功能已驗收，音色尚未定案；不需要重做已通過的刷機與基本音量排查。

- 專案目前已是 Git `master`，起始檢查為工作目錄乾淨；先前「尚無 .git」紀錄已過時。交接 ZIP 在 .199 不存在，但 TTS 原始碼、測試與 TTS_SETUP.md 已在目前 checkout；未解壓覆蓋私有設定。
- .199 執行 Node 14 項與 Python 2 項測試通過；`node tools/check-synthesis.mjs` 對 .100 真實 API 通過，17 kHz／mono／16-bit，3.447 秒、peak 25404，音訊未落盤。
- .199 既有 M5Stack core 3.3.10／M5Unified 0.2.27 工具鏈成功編譯，應用 **1,346,144 bytes**，小於原廠 0x4F0000 應用槽；partitions.csv 仍沿用原廠 offset／size。
- 上一版可用應用留在 .199 `.tools/recovery/pre-tts-20261024.ino.bin`（1,343,664 bytes，SHA256 `a903d52cd24a4a09ed768c6c15110cb1c834c865ac6b5f52b126c3d19285ff80`）。這個私有工具目錄不走 Git，未覆蓋原廠完整備份。
- 使用 COM4、esptool 5.3.0 ROM 模式，**僅寫入 0x20000**，hash 校驗通過並 watchdog reset。新應用 SHA256 `5ae046bba67bedae4ebfea946c2dd467127ddaeee96210051cb3c84537c059ff`。未寫 bootloader、partition table、NVS、assets 或 eFuse。
- .199 服務在計時 idle 時重啟以載入新程式，Wi-Fi ACK 恢復。固定合成短句使用音量 208／加強輸出，狀態 queued → downloading → playback → completed；第一次約 2.556 秒收到播放回報、6.122 秒完成。這是 API／裝置狀態量測，並非聲學量測。
- **使用者實際聽感確認：中文清楚，音量可接受。** 固定測試句不是計時控制指令，沒有操作計時。
- 再次播放採用新 ID 成功，約 2.546 秒播放回報、6.123 秒完成；Wi-Fi ACK 持續更新，第二次檢查前後計時皆 paused，未改動使用者狀態。舊 ID 下載回 HTTP 409，不重播。
- 播放後相機可重新啟動並連續收到 JPEG；檢查後已停止測試相機，沒有保存或展示影像。新增 `tools/check-device-playback.mjs` 可重做固定合成句的 metadata 檢查，它會實際播放但不收音。
- 本輪尚未補真人 STT 在新韌體播放後的回歸、長句／弱網路、真實下載中斷及服務失聯測試。相機仍需手動恢復，基本播放成功不等於完整穩定性驗收。

## .100 部署實測（2026-10-24）

- IP 已實查為 Wi-Fi `192.168.0.100`；RTX 5070、12227 MiB VRAM，驅動 591.86。nvidia-smi 的 CUDA 13.1 是驅動支援資訊，服務實際使用 CUDA 12 pip runtime。
- 已有 Anaconda `C:\ProgramData\anaconda3`（base Python 3.13.9），以及 `C:\Users\atkse\.conda\envs\HardwareAgent`（Python 3.12.13）；兩者未加入本次 shell PATH。**不要因 `python` 指向 WindowsApps 別名而判定未安裝 Python。** 未另外安裝系統 Python。
- 使用 HardwareAgent 的 Python 建立 `services/speech/.venv`，未修改該 conda 環境的套件。使用者已私下放入既有 `settings.local.json`，host/port/model 與金鑰長度檢查通過，未輸出金鑰；跨主機配對仍需實測。
- 安裝版本：faster-whisper 1.2.1、CTranslate2 4.8.3、nvidia-cublas-cu12 12.9.2.10、nvidia-cudnn-cu12 9.27.0.42、nvidia-cuda-nvrtc-cu12 12.9.86。DLL 位於 venv 的 `Lib/site-packages/nvidia/**/bin`，start.ps1 將其加入本程序 PATH。
- small 權重已下載至專案 `.tools/huggingface`；start.ps1 預設沿用此快取。服務本次已啟動 `192.168.0.100:8001`，有金鑰的本機 health 回覆 ready=true、device=cuda、model=small。這不是完整驗收；重開機後需重新啟動，尚無自動啟動設定。
- **真實 GPU 運算已實測**：直接載入 small，裝置 cuda、float16，五秒合成 440 Hz 音訊、關閉 VAD 以強制推論，完整消耗 segments，首輪 12.291 秒成功。這不是人聲準確度測試，也不是裝置全流程；合成內容不作逐字稿品質依據。
- Node v24.16.0 的 13 項測試與 Python 1 項 mock API 測試通過；不將它們當 GPU／裝置驗收。
- 實際 HTTP WAV 合成靜音測試發現 PyAV 19.0.2 移除 `metadata_errors`，與 faster-whisper 1.2.1 不相容；已將 requirements 限制 `av>=11,<19`，安裝 18.1.0 並重啟服務。重測五秒 17 kHz WAV：HTTP 200、空文字、0.234 秒；這是實際模型 API／VAD 靜音測試，不是真人／裝置測試。
- .100 → .199:3000 TCP 兩次逾時（含允許區網的執行環境），使用者表示 .199 已啟動。此結果不能直接證明反向 .199 → .100:8001 不通；已請使用者從 .199 網頁檢查語音服務並準備五秒中文錄音。尚未變更防火牆。
- 使用者於 .199 網頁按「檢查語音服務」回報成功，確認實際使用方向 .199 → .100:8001 的網路與金鑰驗證通過。先前反向 .100 → .199:3000 逾時不影響此項成功結果。
- 使用者回報 .199 網頁恢復、health 顯示 cuda/small，已完成裝置五秒收音並提供中文文字（未將逐字稿寫入此文件）。暫按網頁辨識結果理解；仍需確認是否符合原句與等待時間，不能將佔位時間當實測值。
- 本輪重新核對：8001 監聽程序 PID 21688，同一 PID 出現在 nvidia-smi GPU 程序清單；由 speech venv 啟動，Windows venv 子程序顯示其 conda 基底 Python 路徑屬正常現象。服務設定 CUDA、small，程式沒有自動 CPU fallback。WDDM 回覆顯存占用 N/A，未取得本次請求的獨立 GPU 計時。
- 服務仍在執行，未見新增 console 錯誤；但服務刻意不記錄請求／逐字稿，且捕捉推論例外只回傳 HTTP 錯誤，沒有逐筆追蹤可回溯。因此不能僅憑無 console 輸出宣稱此筆完全無錯；需配合網頁成功結果。
- 使用者後續確認本次辨識內容正確，收音結束後約 5～15 秒顯示文字，屬使用者估計區間而非 Server 精確計時。GPU 實測、跨主機連線及裝置五秒中文基本端到端驗收通過；真人靜音／重試／服務失聯仍未完成，不將基本成功擴大為完整穩定性驗收。

## 本機語音合成接續（2026-10-24）

- 使用者已授權 STT 驗收通過後接續 TTS 與裝置播放。採用此機既有 Windows zh-TW 語音（Hanhan），本機 CPU 合成，不使用雲端，不宣稱 TTS 使用 GPU。
- 新增 `services/speech/synthesis.py`、`synthesize.ps1`；透過標準輸入傳文字，標準輸出取 PCM，音訊不落盤、不直接播放。使用 System.Speech 的記憶體音訊串流，17 kHz、16-bit、單聲道。
- 現有語音服務新增帶相同私有金鑰的 `POST /synthesize`，JSON `text` 限 1～200 字，輸出最長三十秒 PCM，與 STT 共用忙碌鎖；失敗不回傳內部例外或輸入文字。health 新增 tts metadata，STT cuda/small 保持原設定。
- 服務已重啟並實測合成 API HTTP 200：固定中文測試句產生 117186 bytes、3.447 秒音訊，本輪 HTTP 耗時 0.336 秒。這只驗證產生格式與資料，不代表音色／裝置聽感驗收。Windows 語音引擎需在可存取本機語音 COM 的正常使用者環境執行；受限沙箱曾無法列舉語音，正常環境實測成功。
- 最新 Node 14 項、Python 2 項測試通過；涵蓋合成金鑰、文字限制、PCM 大小／格式、峰值衰減、下載過期／去重、播放狀態、音訊互斥與錯誤隱私。`node tools/check-synthesis.mjs` 已在 .100 對真實 API 通過，格式 17k/mono/16bit、peak=25404；尚未從 .199 執行。
- **裝置播放原始碼已完成、尚未編譯／部署／實機驗證**：新增 `synthesis.mjs` 管理 .199 記憶體播放工作，`server.mjs` 提供獨立下載指令與裝置金鑰端點，網頁加入手動合成播放／帶入最新 AI 回覆按鈕。韌體 `NetworkTransport.h` 新增 PSRAM 音訊下載與去重，`AudioProbe.h` 新增下載後播放與依長度逾時、釋放記憶體。舊韌體忽略獨立播放 header，不誤觸收音。
- 使用者確認 USB 在 .199 COM4，.199 可建置並僅刷 `0x20000` 應用槽；授權先完成原始碼與交接，再由 .199 編譯／刷入／驗證。.100 未安裝 Arduino 工具鏈，沒有進行韌體編譯或刷寫。詳細部署、回復及驗證步驟見 `TTS_SETUP.md`。沒有搬移 .199 服務。

## 下一次要完成什麼

下一步由 **.199** 依 `TTS_SETUP.md` 合併交接程式、檢查真實合成 API、編譯並僅刷寫 COM4 的 `0x20000` 應用槽，恢復 Wi-Fi ACK 後驗證裝置中文播放。STT 基本端到端已通過，仍需補靜音／重試／失聯；TTS 的音色、裝置播放及延遲尚未驗收。.100 的語音服務維持啟動。

## 主機與裝置分工

| 位置 | 功能與狀態 |
|---|---|
| 192.168.0.199 | 本次開發主機；Node 24+ 網頁、SQLite、計時、Wi-Fi 裝置 API、OpenCV 相機辨識。目前 localhost:3000 管理網頁可用；執行狀態需重新檢查 |
| 192.168.0.100 | Windows，RTX 5070，系統 RAM 32 GB（不是已確認的顯示記憶體容量）。Ollama :11434 已使用 qwen3.5:4b；Python 已安裝，版本未知。待部署語音服務 :8001 |
| StackChan K151-R | ESP32-S3、16 MB Flash、8 MB PSRAM、GC0308 相機、ES7210 收音及 AW88298 喇叭。USB 在開發主機曾是 COM4；裝置 Wi-Fi 指向 192.168.0.199:3000 |

預定維持兩台分工，不因在 5070 開啟 repo 就搬移 Node、SQLite 或裝置目標網址。IP 仍需現場核對。未部署正式網域或 HTTPS，現階段使用可信任區網 HTTP；未開放網際網路。

## 已完成與已驗證

- 文字對話、番茄鐘、SQLite、離席策略、USB／Wi-Fi 表情與計時同步。
- Wi-Fi 相機預覽，CPU 正面臉部偵測與空位校準；使用者確認方向正常、自動在席初步有效。這不是身分、情緒或工作狀態辨識。
- Wi-Fi 相機啟停、服務中斷後重連已實測。沒有切斷 AP 作斷線測試；獨立電源時使用者回報看起來正常，未作系統化長時間測試。
- 麥克風與喇叭輪流運作。17 kHz 單聲道解決使用者回報的破音／斷續；使用者最終接受「加強輸出」的音量。網頁音量 32～255，預設 208；輸出倍率標準 4、加強 8。
- 放大器播放時讀回：0x0C=0x0064、0x04=0x4040、0x06=0x14C8、0x61=0x0673；通道音量 255。沒有改動放大器寄存器或 boost。這些數值不能證明硬體所有功能均正常。
- 五秒按鈕收音、Wi-Fi PCM 上傳、主機 WAV 封裝、呼叫 STT 服務、網頁顯示辨識文字的程式已加入。
- 最新韌體 1,343,664 bytes 已寫入 0x20000，hash 通過，啟動後 Wi-Fi ACK 正常。5070 上做語音服務工作**不需要重刷裝置**。
- 13 項 Node 測試及 1 項 Python 服務 API 測試通過。語音辨識部分使用 mock 與合成音訊，沒有宣稱真實模型成功。

## 還沒有完成

1. 5070 上 faster-whisper、CUDA cuBLAS／cuDNN 依賴及真實 GPU 推論。
2. 真實五秒錄音的裝置 → 192.168.0.199 → 192.168.0.100 全流程與中文準確度／延遲測試。
3. 語音合成、AI 回覆播放、喚醒詞、主動發言；本階段只有按鈕觸發。
4. STT 服務自動啟動、長時間穩定性及正式 HTTPS 遠端部署。

目前 :8001 健康檢查失敗是預期狀態：Server 服務尚未安裝／啟動，不能因此斷定串接程式故障。

## Git 與私有設定的交接

本次檢查 `C:\Projects\ATK_StackChan` **不是 Git 工作目錄**，沒有 `.git`，也不知道使用者的遠端 URL。沒有初始化、提交、推送或建立 GitHub 儲存庫。若使用者另有真正 repo，需將本資料夾的程式／文件變更帶入，審查忽略規則後提交並推送，另一台才拉得到。本文件不代表同步已完成。

應隨程式交接：根目錄 `AGENTS.md`、本文件、`SPEECH_SETUP.md`、全部程式／測試、`services/speech/` 的 Python、PowerShell、requirements 與 `settings.example.json`，以及其他功能文件。

不會隨 Git 帶過去：

| 項目 | 下一台如何處理 |
|---|---|
| `services/speech/settings.local.json` | **優先私下複製這一個檔案**到新 checkout 同一路徑，保留與 .199 已配對的語音金鑰。不要貼到聊天或提交 |
| 根目錄 `.env` | 留在 .199。GPU 主機只跑語音服務不需要它。若重建 .199，依 `.env.example` 補齊並與語音金鑰配對 |
| `network.dev.h`／`network.local.h` | Wi-Fi 密碼與裝置金鑰留在 .199；語音服務接手不需要 |
| `.tools/`、`services/speech/.venv/` | 此機專用工具不可假定新機存在。5070 跑 `services/speech/setup.ps1` 建立自己的 venv；不需 Arduino／USB／OpenCV 工具 |
| `data/` | .199 的 SQLite 與對話、計時資料。不是語音 Server 部署需求，不要以空資料庫覆蓋 |
| `backups/` | 原廠完整 16 MB 備份留在 .199，需另外保管，不走 Git。SHA256 見 `HARDWARE_STATUS.md` |

若無法取得既有 `settings.local.json`，可以在 5070 執行 `services/speech/configure.ps1` 產生新的獨立金鑰；但必須再把 .199 `.env` 的 `STACKCHAN_STT_TOKEN` 改成同一值並重啟 Node。產生新金鑰不會自動同步另一台。不要只複製空白範本就啟動。

## 下一台的接續順序

1. 確認 repo 檔案齊全、GPU／Python／IP，先讀現有本機設定；不要輸出金鑰。
2. 檢查或私下轉移 `settings.local.json`；新 checkout 路徑不需要與原主機相同。服務設定 host 預設 .100、port 8001、model small。
3. 在 `services/speech` 執行 `./setup.ps1`；需要下載套件。執行 `./diagnose.ps1` 查看 GPU、Python、CTranslate2、DLL，不改系統設定。
4. 依 `SPEECH_SETUP.md` 檢查 CUDA 12 cuBLAS 與 cuDNN 9；勿把「Ollama 能用 GPU」當成此服務可用的證據。需要時查官方文件確認版本，完成後記錄實際套件版本。
5. 執行 `./start.ps1`，首次下載 small 模型；GPU 失敗可用 `./start.ps1 -Device cpu` 排查，保留非敏感錯誤，不將 CPU 當 GPU 完成。
6. 先在 Server 以金鑰檢查 `/health`，再從 .199 執行 `node tools/check-speech.mjs` 或網頁「檢查語音服務」。只在必要時處理 Windows 防火牆 TCP 8001 的 .199 來源連線；目前未新增規則。
7. 請使用者按「收音五秒並辨識」說一個短句，檢查文字及延遲，再測靜音、重試和服務失聯；避免在無人準備時自動收音。辨識結果先供確認，不自動送 AI。
8. 更新本文件：GPU/CPU、版本、實測結果、剩餘問題；通過後再接續 TTS。

## 重要檔案與測試

- `services/speech/server.py`：獨立 STT，Python 標準 HTTP 服務 + faster-whisper；模型只在直接啟動時載入。
- `speech.mjs`：五秒 PCM → WAV、STT 呼叫、job／逾時與記憶體文字。
- `server.mjs`：裝置金鑰、語音命令、原始 PCM 170000 bytes 上傳、202 非同步辨識。
- `firmware/DisplayProbe/AudioProbe.h`：錄音／播放、五秒 raw 上傳；`NetworkTransport.h` 負責 Wi-Fi 佇列。
- `public/app.js`、`public/index.html`：按鈕、辨識狀態與帶入輸入框。
- `node --test`（Node 24+）：13 項；`python tools/test-speech-service.py`：不需 faster-whisper 的 mock API 測試。
- `.199` 的 `node tools/check-speech.mjs`：只查語音服務 metadata，不錄音、不送音訊。

## 不變的資料處理與限制

影像與錄音只在記憶體，不落盤、不送雲端模型。STT 錄音送自己的 .100；對話模型使用 Ollama，沒有 OpenAI API 費用或金鑰。STT 第一次只下載模型權重，不上傳錄音。

STT 與音訊測試會停止相機，暫不自動恢復；使用者可手動啟動並重新校準。未知在席不當作離席，不自動恢復暫停的計時。不要為驗證改動使用者正在進行的計時。

辨識文字只在 RAM，手動確認後帶入輸入框；手動傳送並成功收到 AI 回覆後才保存對話。尚未有完整資料保留政策或長期記憶摘要。

## 可貼給下一台 Codex 的接續指令

「請先讀 AGENTS.md、HANDOFF_5070.md 與 SPEECH_SETUP.md。這台是 192.168.0.100 的 Windows RTX 5070 Server，已有 Python 與 Ollama。接續部署並驗證語音辨識服務，維持 192.168.0.199 的網頁／計時／裝置連線分工，先檢查私有設定與 GPU 依賴，再完成實際五秒中文辨識。不要把 mock 或 CPU 測試當成 GPU 驗收；先不要做 TTS。」
