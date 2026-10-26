# StackChan 韌體驗證

螢幕閒置政策：待機／暫停／完成且 30 分鐘沒有活動時關背光，觸控恢復；正在倒數、語音或馬達動作保持亮屏。背景同步不會喚醒，網頁使用者活動由 X-StackChan-Activity／WebSocket body marker 同步。只有螢幕休眠，計時與連線繼續。完整實機驗收範圍見 HARDWARE_STATUS.md。

目前版本已加入 WebSocket 即時事件與獨立 FreeRTOS 馬達任務；HTTP 保留音訊／相機傳輸及斷線備援。建置需 Arduino `WebSockets@2.7.2`，.199 的 WSL ext4 user libraries 已安裝。主機先執行 `npm ci`。計時動作預設 ±15°，可在網頁往返測試區選擇 5～30°後「套用至番茄鐘」；動作圍繞已保存的中心。實機驗證範圍以 `HARDWARE_STATUS.md` 最新節為準。

已加入可設定的 Wi-Fi／HTTPS 背景傳輸。設定載入優先序為不納入 Git 的 `network.prd.h`、`network.dev.h`、`network.local.h`，範本為 `network.example.h`。正式設定必須是可達的 HTTPS 網址並提供對應根 CA；完整設定與目前候選狀態見根目錄 `CONFIGURATION.md`。

`DisplayProbe` 接收主機的番茄鐘、在席、表情與一次性 body cue，並回覆套用確認；同時支援 Wi-Fi 相機、收音與 TTS。開機不初始化馬達，只有具唯一 ID、未過期且未被語音／相機阻擋的計時事件可呼叫已驗證的約 +3.1° yaw 往返。pitch 與 yaw 負方向仍停用。

編譯工具使用 Arduino CLI、M5Stack 官方 CoreS3 選板、M5Unified。工具與下載檔在 `.tools/`；設定檔為 `tools/arduino-cli.yaml`。目前設定路徑對應此 Windows 工作目錄。

目前已安裝 M5Stack core 3.3.10、M5Unified 0.2.27、M5GFX 0.2.34。使用 `./tools/build-firmware.ps1` 重建，腳本不會自動上傳。

`DisplayProbe/partitions.csv` 對應這台裝置實際讀出的原廠分割表。保留 nvs、otadata 與 assets；不要用一般 CoreS3 預設分割配置直接覆寫。編譯成功並不代表硬體已驗證，實際刷入狀態以根目錄 `HARDWARE_STATUS.md` 為準。

第一版硬體探針刷入後曾無法可靠退出下載狀態，短按底部 RST 後恢復。新版同步韌體使用 esptool 5.3.0 `--after watchdog-reset`，此次已直接啟動並回覆同步確認。若後續畫面不亮，先短按底部 RST（不要長按）；不要直接重新清除 Flash。

完整 Flash 備份位於 `backups/`，不納入版本控制。`.partial` 一律不可還原。完成的 `.bin` 須搭配 `.json` 中的長度、讀取方式與 SHA256 檢查；原廠備份已在第一次刷入前通過整份裝置端 digest 校驗，但未實際做過完整還原寫入測試。

同步協定 v2：每次傳送 `S|session8hex|seq|seconds|phase|status|expression|presence|flags|cueId|cueCode`，以換行結尾。flags 分別控制燈效與安全動作；cue ID 為 `00000000` 或 8 位小寫十六進位，code 為 none／greet／warning／done。裝置拒絕重複 sequence，相同 cue ID 只處理一次；ACK 必須回傳相同 `effect_id`。15 秒未收到有效資料即顯示失聯與 `--:--`，主機只承認近期、同 session 且欄位完全相符的回覆。

顯示使用 16-bit M5Canvas 緩衝，完成一整張畫面才推送 LCD；相同內容不重畫。`sync_ack.render_count` 可觀察更新次數；執行 `node tools/check-device.mjs idle --stable` 可檢查待機時仍持續確認同步但不增加畫面重繪次數。

目前動畫依 `design/expression-sprites.png` 的 4×7 設計以幾何圖形重現：四種語意表情各四格、TTS 四段嘴型、收音四段波紋及 neutral 的左右環顧。PNG 是設計參考，不會寫入 assets 分割區；韌體只需應用槽。動畫幀重畫不增加語意 `render_count`。

主機橋接由 `device.mjs` 啟動 `tools/serial-bridge.py`，只保留最新待送狀態，不在重連後重播舊資料。主機計時仍是唯一依據。測試指令 `node tools/check-device.mjs idle` 可核對即時裝置與主機剩餘時間（執行中可將 idle 改為 running 或 paused）。

備份工具：

```powershell
# 使用專案安裝 esptool 的 Python 環境執行，只讀取，不會刷入。
python tools/backup-flash.py --port COM4 --rom --output backups/new-backup.bin
```

需要先將 esptool 安裝於 `.tools/python`；目前使用 bundled Python 3.12.14 及 esptool 5.1.0。當前埠號未必永久為 COM4，拔插或進下載模式後請重新確認。
