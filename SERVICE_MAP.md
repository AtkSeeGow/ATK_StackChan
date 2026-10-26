# StackChan 站台與服務命名

更新：2026-10-26。名稱代表角色，不隨 IP 或主機搬移而改名；文件與討論優先用下列名稱。IP 只作目前部署位置對照。

| 正式名稱 | 識別名稱 | 職責 | 目前部署位置 |
| --- | --- | --- | --- |
| StackChan 控制站 | `stackchan-control` | 網頁、計時、設定與紀錄、裝置連線、WebSocket、語音預備排程、相機在席辨識 | 192.168.0.199；Node 3000 |
| StackChan AI 語音站 | `stackchan-ai` | Ollama 對話與台詞、GPU STT、R2 角色 TTS、Hanhan 備援 | 192.168.0.100；RTX 5070 |
| StackChan 裝置 | `stackchan-device` | 觸控、表情、背光、收音／播放、燈效與馬達 | 目前由控制站的 COM4 刷寫，日常經 Wi-Fi 連線 |

## 服務名稱

| 服務名稱 | 所屬站台 | 現有程式／接口 |
| --- | --- | --- |
| 控制服務 | 控制站 | `server.mjs`，HTTP 3000，含網頁與 WebSocket |
| 在席辨識服務 | 控制站 | 相機辨識 worker；影像僅在記憶體 |
| 對話服務 | AI 語音站 | Ollama，11434；對話與番茄鐘台詞 |
| 語音服務 | AI 語音站 | `services/speech`，8001；STT／TTS API |
| R2 角色語音引擎 | AI 語音站 | 語音服務管理的獨立 GPU worker，非另開一份8001服務 |
| Hanhan 備援語音引擎 | AI 語音站 | Windows CPU TTS，由語音服務在角色引擎失敗／逾時時使用 |

連線方向：**裝置 ↔ 控制站 → AI 語音站**。語音預備的排程／PCM 快取在控制站，實際台詞生成及語音合成在 AI 語音站。

`stackchan-control`／`stackchan-ai`／`stackchan-device` 目前是文件識別名稱，尚未設定成可解析的 DNS、主機名稱或公開網域。此次正名不修改 `.env`、網址、Wi-Fi、金鑰、Windows 電腦名稱、程序或部署位置；跨網路時再依選定的網域／私人網路方式調整連線。

日常啟動與設定見 [SPEECH_SETUP.md](SPEECH_SETUP.md)、[TTS_SETUP.md](TTS_SETUP.md)、[CONFIGURATION.md](CONFIGURATION.md)；目前部署與驗收進度見 [HANDOFF_5070.md](HANDOFF_5070.md)。舊紀錄中的 `.199` 指控制站，`.100`／5070 主機指 AI 語音站。為保留當時實測位置，歷史紀錄不全面替換 IP。
