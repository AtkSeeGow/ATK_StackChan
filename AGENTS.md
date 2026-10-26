# 接手入口

先讀 `HANDOFF_5070.md`，再依工作範圍讀 `SPEECH_SETUP.md` 或其他功能文件。`PROJECT_BRIEF.md` 是最初需求討論，不代表最新實作狀態。

站台正式名稱見 `SERVICE_MAP.md`：使用「StackChan 控制站」與「StackChan AI 語音站」，不以 IP 代稱服務。R2 角色聲線已由使用者接受；AI 語音站接續工作為語音穩定性、效能與故障恢復驗收，不重新選聲。基本聽感通過不等於全部整合驗收。

- 以繁體中文溝通。5070 STT 與 .199 刷入後的裝置 TTS 基本驗收已通過，使用者確認中文清楚、音量可接受；最新完成範圍與待驗證項見 HANDOFF_5070.md。
- 站台分工：控制站目前位於 192.168.0.199，執行 Node 網頁／計時／裝置連線及相機辨識；AI 語音站目前位於 192.168.0.100，是 Windows RTX 5070、32 GB RAM，執行 Ollama、GPU STT、R2 GPU TTS worker 與 Hanhan CPU 備援。不要因切換電腦而默認搬移整套主機服務。
- 專案不依賴這段聊天才能接手；每次完成一階段，把實測結果與未驗證項更新至交接文件。主機 IP、工具與目前執行狀態需在新環境重新檢查。
- `.env`、`settings.local.json`、`network.dev.h`、`network.local.h`、`data/`、`.tools/`、`backups/` 不在 Git 交接範圍。不要印出或提交密碼／金鑰。
- 相機及錄音只在記憶體處理；勿為測試而儲存、上傳外部服務或在聊天中展示影像／錄音。合成測試資料不受此限制。
- 實際 GPU 推論、裝置錄音及跨主機串接必須分別驗證；mock 測試、CPU 模式或單純 health 成功不能當作全部驗收完成。
- 裝置保留原廠分割表與備份；目前不初始化馬達。5070 主機的語音工作通常不需要重刷裝置。若另有韌體工作，先讀 `HARDWARE_STATUS.md`；僅寫應用槽 0x20000，保留其他區域。
- 測試：Node 24+ 的 `node --test`；Python 的 `python tools/test-speech-service.py` 使用標準函式庫與 mock，不需下載模型。改語音服務時也執行這兩項；只改文件時核對文件與指令即可。
