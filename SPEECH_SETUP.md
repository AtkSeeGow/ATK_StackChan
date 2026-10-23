# 在 5070 Windows Server 啟動語音辨識

語音辨識已在 `192.168.0.100` 以 CUDA/small 啟動，使用者確認裝置五秒中文辨識正確、約 5～15 秒顯示結果。詳細驗證範圍見 `HANDOFF_5070.md`。Ollama 繼續使用原本 11434；語音服務獨立使用 8001，不修改 Ollama。本機 CPU 合成 API 已加入，裝置播放部署接續見 `TTS_SETUP.md`。

## Server 操作

2026-10-24 .100 已部署：可使用既有 conda 的 Python 建立隔離環境，不必修改 base 或 HardwareAgent 套件。在本 repo 根目錄可執行：

```powershell
.\services\speech\setup.ps1 -Python C:\Users\atkse\.conda\envs\HardwareAgent\python.exe -Gpu
.\services\speech\start.ps1
```

`-Gpu` 安裝 venv 專用 CUDA 12 cuBLAS／cuDNN 9；啟動腳本自動將 NVIDIA wheel DLL 目錄加入程序 PATH，模型預設快取於 repo `.tools/huggingface`（可用既有 HF_HOME 覆寫）。實測 small CUDA float16 已完成五秒合成音訊強制推論，首輪 12.291 秒；真人裝置中文與跨主機結果請以 `HANDOFF_5070.md` 最新實測為準。此部署尚未設定開機自動啟動。

faster-whisper 1.2.1 的 WAV 解碼與 PyAV 19 不相容（`metadata_errors` 參數已移除），requirements 已限制 `av<19`，此機實測使用 18.1.0；請依 requirements 安裝，避免單獨升級 PyAV。修正後五秒合成靜音 WAV API 回覆 HTTP 200、空文字。

若是直接在 Server 拉 Git，先讀 `HANDOFF_5070.md`：`settings.local.json` 不在 Git 內，必須另行私下轉移。已有配對設定時勿重新產生；沒有時可跑 `./configure.ps1`，之後需同步 .199 的語音金鑰。`settings.example.json` 是不含金鑰的可提交範本。安裝後可用 `./diagnose.ps1` 檢查 GPU／DLL；它不等於實際辨識測試。

1. 將本專案 `services/speech` 整個資料夾複製到 Server，例如 `C:\StackChanSpeech`。請連同已準備的 `settings.local.json` 一起複製；它含有獨立語音金鑰，不要貼到對話或提交到版本控制。
2. 在 Server 開啟 PowerShell，進入該資料夾，執行：

```powershell
cd C:\StackChanSpeech
.\setup.ps1
.\start.ps1
```

`setup.ps1` 使用 Server 的 `python` 建立專用 `.venv`，從套件來源下載安裝 faster-whisper，不修改系統套件。建議 Python 3.11 或 3.12。服務第一次啟動會下載 `small` 多語言模型，需網路及數百 MB 空間；模型權重會快取，錄音不寫入檔案。

預設 GPU 模式需要 NVIDIA cuBLAS for CUDA 12 與 cuDNN 9 for CUDA 12，DLL 目錄需在啟動服務的 PATH 中。顯示卡驅動與 Ollama 本身不能證明這些依賴已備妥。GPU 相容性與實際效能仍需在這台 5070 上驗證；若啟動出現 DLL 或 GPU 錯誤，先保留完整錯誤文字供排查。也可以明確改用 CPU 驗證流程：

```powershell
.\start.ps1 -Device cpu
```

這只代表 CPU 模式可用，不代表 GPU 已驗證。服務視窗需保持開啟。成功時顯示 `Speech service ready`；服務綁定 `192.168.0.100:8001`。

## 本機操作

本機 `.env` 已準備 `STACKCHAN_STT_URL=http://192.168.0.100:8001` 與 `STACKCHAN_STT_TOKEN`，金鑰與上面 JSON 配對。若改 Server IP、埠或金鑰，兩端需對應修改，本機重啟 `node server.mjs`。

回到網頁最下方「語音轉文字」，按「檢查語音服務」。確認連線後按「收音五秒並辨識」，聽到短音、等約一秒，再說一個短句。收音五秒後自動上傳，辨識最多等 120 秒，冷啟動可能較久。

先確認辨識文字，再按「帶入對話輸入框」，可自行修正後按傳送。本階段不自動送給 Ollama，也尚未把 AI 回覆合成語音。相機在收音開始時停止，結束後可手動重新啟動並校準。

若 Server 顯示 ready 但網頁無法連線，檢查 Windows 防火牆是否允許來自本機 `192.168.0.199` 的 TCP 8001；本輪未修改 Server 防火牆。

## 資料與驗證範圍

裝置錄音為五秒 17 kHz、16-bit 單聲道 PCM，主機包成 WAV 後送至自己的 Server。錄音不做回放增益放大，語音模型自行解碼／重取樣。裝置、Node 與 Python 均只在記憶體保留音訊，不寫入 SQLite 或音訊檔；服務不記錄逐字稿或 HTTP 請求。辨識文字暫存在本機服務記憶體，直到下一次辨識或服務重啟；只有手動送出對話並收到 AI 成功回覆後，才依原有對話規則保存。

服務限制單次五秒，需獨立金鑰，僅同時辨識一段；過期或重複裝置上傳會拒絕。模型仍可能誤認、漏字或在雜音下產生文字，請先確認結果。開發區網使用 HTTP；跨網路仍依原規劃改 HTTPS。

2026-10-24 驗證：13 項 Node 測試及 Python 服務 API 測試通過，使用合成音訊與模擬模型，涵蓋 WAV 格式、金鑰、長度、指令過期、重複上傳、錯誤回覆與不自動送對話。尚未在 5070 Server 安裝／執行真實模型，也尚未驗證實際五秒人聲辨識。

來源：[faster-whisper 官方需求及 GPU 安裝說明](https://github.com/SYSTRAN/faster-whisper#requirements)。
