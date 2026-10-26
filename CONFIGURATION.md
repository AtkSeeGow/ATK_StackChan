# 設定位置與部署路徑

站台名稱以 [SERVICE_MAP.md](SERVICE_MAP.md) 為準：**控制站**負責本文件的 Node `.env` 與裝置連線；**AI 語音站**負責 Ollama、STT／TTS。下方歷史 `.199` 指控制站、`.100` 指 AI 語音站，實際 IP／網址只作連線設定。識別名稱尚未建立 DNS，本輪正名沒有變更網路或部署。

## 辦公室正式網路候選（2026-10-27，尚未刷入）

`firmware/DisplayProbe/network.prd.h` 現在為最高優先設定檔，其次才是 `network.dev.h`、`network.local.h`；三者都排除版本控制，不得輸出其中的密碼或金鑰。正式設定仍須使用可從裝置所在網路連線的 HTTPS 網址及對應根 CA，否則韌體會保留 USB 模式。

目前新增的 `network.prd.h` 已通過 SSID、密碼及 64 字元裝置金鑰存在性檢查，但網址仍是公開主機名稱的 HTTP，根 CA 留白；2026-10-27 從目前環境連線該主機的 TCP 80／443 也未成功。因此未將此候選刷入裝置。待控制站 HTTPS 反向代理與外部連線成立、設定改為 HTTPS 並填入實際憑證鏈根 CA 後，才重新編譯，只寫應用槽 `0x20000`，再從辦公室網路驗證 WebSocket、狀態、相機、語音及斷線恢復。

## 目前區網 HTTP 開發模式（2026-10-23）

已讀取 `firmware/DisplayProbe/network.dev.h`，優先於 `network.local.h`；目前使用 `http://192.168.0.199:3000`，兩端金鑰已補齊。韌體只允許私人 IPv4 的 HTTP 開發網址，HTTPS 仍驗證根憑證。

主機 `.env` 的 `STACKCHAN_DEV_ORIGIN` 設為上述網址、`STACKCHAN_TRANSPORT=wifi`。開發模式監聽所有介面，但區網僅允許設定 Host 的裝置 API，且需要裝置金鑰；管理網頁仍從本機 `http://127.0.0.1:3000` 使用。不能與 `STACKCHAN_PUBLIC_ORIGIN` 同時設定。HTTP 不加密，僅供可信任區網測試。未新增 Windows 防火牆規則。

已刷入並收到實機 Wi-Fi ACK、連續 JPEG 影像，主機未啟動 COM 橋接。相機由網頁啟動／停止，辨識在主機本機執行，COM 相機程式仍保留。獨立電源及實際 Wi-Fi AP 斷線恢復仍待驗證。

切回 USB：將 `network.dev.h` 改名為 `network.dev.h.disabled`（仍包含密碼，不要提交），確保 `network.local.h` 的 SSID 留白，重新編譯刷入；主機設 `STACKCHAN_TRANSPORT=usb` 並重啟。正式 HTTPS 部署時也需停用開發檔，改填 `network.local.h`，清空 `STACKCHAN_DEV_ORIGIN`，再依下方正式部署欄位設定。

以下是前一階段設定與驗證紀錄。

相機目前僅支援 USB，使用與橋接相同的 `STACKCHAN_PYTHON`；操作、依賴版本與記憶體保存規則見 [CAMERA.md](CAMERA.md)。本機相機功能不需額外雲端金鑰。下列 Wi-Fi 建置結果為前一階段紀錄，尚未涵蓋相機無線傳輸。

目前先保留 localhost 與 USB，網頁為 http://127.0.0.1:3000 。Wi-Fi／HTTPS 程式已加入，但尚未填入 Wi-Fi 資料、測試無線連線或刷入新網路韌體。

驗證結果：10 項自動測試通過，包含在 localhost 啟動的模擬遠端 API、管理與裝置權限隔離、回報核對、重播拒絕與代理 HTTPS 標記。USB 預設版與啟用 Wi-Fi 的測試版均編譯成功；啟用版約 1.23 MB，小於原廠 OTA 槽。測試版使用虛構 Wi-Fi／網域資料，只驗證建置，未刷入或連上真實網路。

## 主機：根目錄 `.env`

已建立 `.env`；範本為 `.env.example`。修改後重新啟動 `node server.mjs`。

| 設定 | 目前／用途 |
|---|---|
| PORT | 3000 |
| STACKCHAN_TRANSPORT | `usb`；實際改用無線裝置時設為 `wifi` |
| STACKCHAN_SERIAL_PORT | COM4；wifi 模式不啟動 USB 橋接 |
| OLLAMA_URL | 新資料庫預設模型主機；搬到 GPU Server 可改為 `http://127.0.0.1:11434` |
| OLLAMA_MODEL | 新資料庫預設模型；目前 qwen3.5:4b |
| STACKCHAN_PUBLIC_ORIGIN | 目前留白；正式使用填完整 `https://你的網域`，不要尾端 `/` |
| STACKCHAN_DEVICE_TOKEN | 主機與裝置共用的隨機金鑰，至少 32 字元 |
| STACKCHAN_WEB_USER | 公開管理網頁的登入名稱 |
| STACKCHAN_WEB_PASSWORD | 公開管理網頁的獨立密碼，至少 16 字元 |

Ollama 的既有設定保存在 SQLite，會優先於 `.env` 的預設值。搬移已有資料庫時，請在網頁「模型連線設定」確認網址。

需要金鑰時執行 `node tools/generate-keys.mjs`，會只補齊 `.env` 的空白認證欄位，不輸出密碼、不覆蓋既有值，也不開放網際網路。主機未設定裝置金鑰時，裝置 API 不可使用。

後端固定監聽 127.0.0.1，不直接開放區網。正式環境由同一台 Server 上的 HTTPS 反向代理接收連線。設定 public origin 時，後端會要求管理網頁登入，並檢查網域及代理傳入的 HTTPS 標記。裝置金鑰不能用來操作管理網頁或番茄鐘。

## 裝置：`firmware/DisplayProbe/network.local.h`

已建立留白設定檔，範本為同資料夾 `network.example.h`。兩個檔案都不要填到對話中；`network.local.h` 已排除版本控制。

| 設定 | 用途 |
|---|---|
| STACKCHAN_WIFI_SSID | 2.4 GHz Wi-Fi 名稱；留白時維持 USB 模式 |
| STACKCHAN_WIFI_PASSWORD | Wi-Fi 密碼 |
| STACKCHAN_SERVER_URL | 正式 HTTPS 網域；裝置不能填 localhost 或 127.0.0.1 |
| STACKCHAN_DEVICE_TOKEN | 與主機 `.env` 相同的裝置金鑰 |
| STACKCHAN_ROOT_CA | 對應 HTTPS 憑證鏈的根 CA PEM，可用 C++ raw string 填入 |
| STACKCHAN_NTP_SERVER | 裝置校時來源；預設 pool.ntp.org |

韌體驗證 HTTPS 憑證及主機名稱，不停用憑證檢查，也不跟隨重新導向。有效 Wi-Fi 設定須包含 HTTPS 網址、裝置金鑰與根 CA；設定不足時保留 USB 模式。裝置連線前會等待校時，以驗證憑證有效期限。

修改裝置設定後，需要重新編譯／刷入；Wi-Fi 不會從主機 `.env` 自動傳到裝置。無線程序在背景執行，畫面繪製不等待 HTTP；只保留最新狀態，不重播斷線期間的資料。HTTPS 每約 2 秒輪詢，15 秒沒有有效顯示更新即顯示失聯，主機 12 秒無有效確認會標示未連線。

localhost 指目前執行程式的那一台機器。現階段可在電腦上測後端，未實測裝置透過公司 Wi-Fi 連線。正式連線時，裝置只需供電；網頁、計時、紀錄與 Ollama 應都放在遠端 Server。

## 反向代理：`deploy/Caddyfile.example`

這是未套用的 Caddy 範例。之後改成你的網域，將 DNS 指向固定 IP，並依實際網路設定將 HTTPS 流量導到 Server 的反向代理。沒有變更 DNS、防火牆、路由器或正式主機。

範例依據 [Caddy 官方反向代理文件](https://caddyserver.com/docs/quick-starts/reverse-proxy)。本輪沒有安裝或啟動 Caddy。

正式遷移時先停止原服務、備份／移動整個 data 資料夾，在 Server 安裝 Node.js 24，修改 `.env` 和網頁內的模型網址，啟動後端與 HTTPS 代理，再完成裝置無線驗證。USB 模式的 Python 不是無線部署的必要依賴。
