# StackChan 韌體驗證

已加入可設定的 Wi-Fi／HTTPS 背景傳輸，設定檔為本資料夾 `DisplayProbe/network.local.h`（範本 `network.example.h`）。目前 SSID 留白，保留 USB；裝置上的實際韌體仍是上一輪已驗證的 USB／離屏繪製版本，這次未刷入網路版本。完整設定說明見根目錄 `CONFIGURATION.md`。

`DisplayProbe` 目前已升級為 USB 同步韌體：接收主機的番茄鐘、在席狀態與表情，並回覆套用確認。它不初始化 StackChan Motion，不發送馬達指令，也不開啟相機、喇叭或 Wi-Fi。前一版硬體探針曾回報 Flash、PSRAM 與畫面尺寸；目前不再輸出該格式。

編譯工具使用 Arduino CLI、M5Stack 官方 CoreS3 選板、M5Unified。工具與下載檔在 `.tools/`；設定檔為 `tools/arduino-cli.yaml`。目前設定路徑對應此 Windows 工作目錄。

目前已安裝 M5Stack core 3.3.10、M5Unified 0.2.27、M5GFX 0.2.34。使用 `./tools/build-firmware.ps1` 重建，腳本不會自動上傳。

`DisplayProbe/partitions.csv` 對應這台裝置實際讀出的原廠分割表。保留 nvs、otadata 與 assets；不要用一般 CoreS3 預設分割配置直接覆寫。編譯成功並不代表硬體已驗證，實際刷入狀態以根目錄 `HARDWARE_STATUS.md` 為準。

第一版硬體探針刷入後曾無法可靠退出下載狀態，短按底部 RST 後恢復。新版同步韌體使用 esptool 5.3.0 `--after watchdog-reset`，此次已直接啟動並回覆同步確認。若後續畫面不亮，先短按底部 RST（不要長按）；不要直接重新清除 Flash。

完整 Flash 備份位於 `backups/`，不納入版本控制。`.partial` 一律不可還原。完成的 `.bin` 須搭配 `.json` 中的長度、讀取方式與 SHA256 檢查；原廠備份已在第一次刷入前通過整份裝置端 digest 校驗，但未實際做過完整還原寫入測試。

同步協定 v1：每秒傳送 `S|session8hex|seq|seconds|phase|status|expression|presence`，以換行結尾。裝置只接受有界數值與列舉，回覆 `sync_ack` JSON。5 秒未收到有效資料即顯示失聯與 `--:--`。重複 sequence 被拒絕，主機新 session 可從新序號開始。主機只承認近期、同 session 的有效回覆；不會因 COM 埠能開啟就宣稱裝置已連線。

顯示使用 16-bit M5Canvas 緩衝，完成一整張畫面才推送 LCD；相同內容不重畫。`sync_ack.render_count` 可觀察更新次數；執行 `node tools/check-device.mjs idle --stable` 可檢查待機時仍持續確認同步但不增加畫面重繪次數。

主機橋接由 `device.mjs` 啟動 `tools/serial-bridge.py`，只保留最新待送狀態，不在重連後重播舊資料。主機計時仍是唯一依據。測試指令 `node tools/check-device.mjs idle` 可核對即時裝置與主機剩餘時間（執行中可將 idle 改為 running 或 paused）。

備份工具：

```powershell
# 使用專案安裝 esptool 的 Python 環境執行，只讀取，不會刷入。
python tools/backup-flash.py --port COM4 --rom --output backups/new-backup.bin
```

需要先將 esptool 安裝於 `.tools/python`；目前使用 bundled Python 3.12.14 及 esptool 5.1.0。當前埠號未必永久為 COM4，拔插或進下載模式後請重新確認。
