# 5070 主機接手紀錄

更新：2026-10-24。接手時先核對此文件，再讀 `SPEECH_SETUP.md`。本次使用者決定先停在這一階段，未在 5070 Server 安裝任何新服務。

## 下一次要完成什麼

在 **192.168.0.100 的 Windows RTX 5070 主機**啟動本機語音辨識，驗證裝置五秒錄音能轉成文字。先完成實際語音辨識驗收，再規劃語音合成。CPU 可作排查，但須明確標示，不能當作 GPU 完成。

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
