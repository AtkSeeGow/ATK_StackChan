# K151-R 硬體驗證

日期：2026-10-23。

## 2026-10-24 語音播放接續

使用者確認裝置仍接在 .199 的 COM4。已完成合成語音下載／播放原始碼，尚未在 .199 編譯、刷入或實機驗證；目前裝置仍是原有可用版本。由 .199 依 `TTS_SETUP.md` 編譯後，僅刷 `0x20000` 應用槽並核對 hash、啟動與 Wi-Fi ACK。未改 bootloader、分割表、NVS、assets，未初始化馬達。

## 最新階段：音訊硬體測試

128/255 音量仍偏小，加入最多四倍人聲增益、20000 峰值上限與近靜音不放大條件，回放改為 160/255。應用 1,340,560 bytes 已寫入 0x20000 並通過 hash 校驗。原始最近峰值 4943、RMS 271.29；增益版實際聽感待確認。

使用者已確認 17 kHz 單聲道版人聲清楚、連續，但音量偏小。只將回放音量從 96/255 提高至 128/255，應用仍為 1,340,464 bytes，寫入 hash 校驗通過；未更動錄音格式或提示音音量。較高音量的聽感待確認。

首次回放使用者回報破音／斷續。診斷版改為官方範例相同的 17 kHz 單聲道、增加音訊緩衝與任務優先序，暫不放大錄音。中途一次首段寫入及 USB 重連失敗，使用者重新接線進入下載模式後，已成功完整寫入 1,340,464 bytes，hash 校驗通過，Wi-Fi ACK 已恢復。新版聽感仍待確認。

已刷入 1,340,032 bytes 應用，hash 校驗通過，Wi-Fi ACK 恢復。加入按需短音、兩秒錄音及裝置回放；測試前關閉相機以恢復 I2C 控制。主機只接收數值，不接收錄音。12 項自動測試通過；聽感與實際人聲收音尚待確認，詳見 AUDIO.md。

## 最新階段：Wi-Fi 相機

補充驗證：停止預覽後影像端點 404，重新啟動連續收到三張新影像；主機服務離線九秒後重啟，Wi-Fi ACK 自動恢復。服務重啟時相機預設關閉，手動啟動後再收到連續 JPEG。這驗證的是服務中斷恢復，未切斷 Wi-Fi AP，也未直接讀取感測器拍攝電流。

已刷入 1,307,376 bytes 應用，0x20000 寫入 hash 通過。主機在 COM 橋接停用時收到連續 Wi-Fi JPEG（實測其中一張 10,042 bytes），同期 ACK 正常，表情與計時顯示維持同步。影像僅在記憶體；CPU 本機辨識，不送對話模型。以下為歷史紀錄，當時的「不支援無線相機」限制已解除；遠端 HTTPS 與實際 AP 斷線仍待驗證。

## 最新階段：區網 HTTP 同步

已使用 network.dev.h 建置並刷入 1,305,424 bytes 應用，0x20000 寫入 hash 通過。實機透過 Wi-Fi 回覆有效 ACK，主機停用 COM 橋接；同步 idle／300 秒與 teasing 表情。12 項自動測試通過，包含區網裝置金鑰、Host 與管理頁隔離。此版尚未支援相機無線傳輸，Wi-Fi 模式不拍攝。獨立電源與實際斷線恢復待驗證。

## 最新階段：USB 相機

GC0308 已啟用，320×240 JPEG 約每兩秒傳到主機，預覽與 USB 計時同步可同時運作。應用映像 700,032 bytes，僅寫入 0x20000，寫入校驗通過並已啟動。使用者確認預覽方向正常且能看到自己的臉。影像未落盤；初步在席判斷與限制見 CAMERA.md。尚未驗證實際離席準確率及無線影像傳輸。下方為先前各階段紀錄。

## 閃爍修正

使用者回報同步後持續閃爍。原因為每 250 ms 直接清空並重畫 LCD。已改用 320×240、16-bit M5Canvas 離屏繪製，再一次 pushSprite；只有連線、秒數、模式、狀態、表情或在席狀態改變才更新。緩衝區約 150 KiB，分配失敗會顯示錯誤並停止繪製，不退回反覆清屏。

修正版映像 542,080 bytes，編譯與應用槽寫入校驗通過。服務與 USB 同步已恢復。實機連續 4 秒確認：USB 確認時間持續更新、idle／1500 秒保持一致、renderCount 固定為 2（初始離線畫面與第一次同步畫面），未繼續重畫。最終視覺效果仍可由使用者觀察；尚未量測 LCD 掃描撕裂。

## 最新階段：USB 同步已接通

DisplayProbe 已升級為 USB 同步韌體：536,720 bytes，編譯成功，只寫入 0x20000 應用槽，寫入校驗通過。這次使用 esptool 5.3.0 `--after watchdog-reset`，寫入後已直接收到新協定確認，無需手動短按 RST。

主機已實際傳送並收到裝置確認：running（倒數）、paused（暫停）、idle（重設），裝置回報剩餘秒數與主機差距小於 3 秒，並回報 teasing 表情。測試結束已恢復 idle／1500 秒。網頁顯示 COM4 已連線。

新韌體每秒接收主機顯示狀態、回覆 session／sequence 確認；5 秒失聯時顯示離線與 --:--。尚未實際拔線驗證失聯畫面；自動測試涵蓋過期、重複、錯誤 session 與無效資料的確認拒絕。

相機、喇叭、Wi-Fi 與馬達尚未接入；裝置不接收計時控制指令，只接收顯示狀態。以下螢幕探針記錄為前一步歷史。

## 已驗證

- Windows 序列埠：COM4；USB VID 303A / PID 1001；USB Serial/JTAG。
- esptool 實測：ESP32-S3 QFN56 revision v0.2，240 MHz，40 MHz 晶振。
- Flash：16 MB，quad 介面。
- 工具：esptool 5.1.0，安裝在專案 `.tools/python`，未修改系統 Python。
- 以 ROM 讀取成功取得 64 KB，並解析原廠分割表。
- 原廠 ota_0 應用描述：project `stack-chan`，version `1.4.4`，ESP-IDF `v5.5.4`；由讀取中的備份解析，尚未確認哪個 OTA 槽為啟動槽。
- 一般 RAM stub 讀取模式多次出現傳輸中斷；降低 baud、16 KB 分段與手動下載模式均未解決。不能因此判定線材或裝置損壞。
- 未執行 erase-flash 或 eFuse 寫入。備份完成後已寫入螢幕測試應用，見下方狀態。

## 原廠分割表（由實機讀取）

| 名稱 | 起點 | 大小 |
|---|---:|---:|
| nvs | 0x9000 | 0x4000 |
| otadata | 0xD000 | 0x2000 |
| phy_init | 0xF000 | 0x1000 |
| ota_0 | 0x20000 | 0x4F0000 |
| ota_1 | 0x510000 | 0x4F0000 |
| assets | 0xA00000 | 0x400000 |
| coredump | 0xE00000 | 0x10000 |

完整備份已完成：`backups/stackchan-factory-20261023-rom.bin`，16,777,216 bytes。

SHA256：`15b0661bccd3ca90ad5f653556e85fa83cfd180667adcefa2a9aaf9fc6822ac7`。

刷入前使用 esptool 5.3.0 ROM `verify-flash` 核對整份原廠映像，裝置端 digest matched。這是讀回校驗，不等同實際做過完整還原測試。

`backups/*.partial` 是較早失敗的嘗試，不可當作還原映像；64 KB header 也不是完整韌體備份。

安全資訊：Secure Boot disabled，Flash Encryption disabled，未修改 eFuse。

## 測試韌體建置

- Arduino CLI 1.5.2-rc.1（官方 latest Windows 下載實際回報版本）。
- M5Stack Arduino core 3.3.10；M5Unified 0.2.27；M5GFX 0.2.34。
- 選板 `m5stack:esp32:m5stack_cores3`，Custom partitions、QSPI PSRAM、Hardware CDC/JTAG、USB CDC on boot。
- `DisplayProbe` 編譯成功，應用映像 519,216 bytes，小於原廠 0x4F0000 的 OTA 槽。
- 產生的 partition entries 與原廠讀回的全部 entries 相同。沒有上傳新的 partition table。
- OTA 記錄：第一筆序號 1、狀態 2、CRC 0x4743989A，符合該序號 CRC；第二筆為空白，指向 ota_0（0x20000）。
- 已使用 esptool 5.3.0 ROM 模式將 519,216 bytes 應用寫至 0x20000，寫入 hash 驗證通過。未更新 bootloader、partition table、otadata、nvs 或 assets。
- 初次自動重啟後黑畫面，USB 無回報；ROM run/watchdog-reset 嘗試也未能確認啟動。使用者短按底部 RST 後，已確認出現測試表情與字樣。
- 短按 RST 後，USB 連續收到 4 筆正常診斷回報：Flash 16,777,216 bytes、PSRAM 8,388,608 bytes、畫面 320×240，uptime 持續增加（26～32 秒）。螢幕顯示、USB 與 8 MB PSRAM 驗證通過。
- 後續刷入流程須包含「確認退出下載模式」；自動 reset 在本次連線未能可靠啟動應用，必要時短按底部 RST，不能把 upload/hash 通過等同應用已啟動。自動重啟失效的底層原因未確定。

## 自訂韌體前置規則

1. 完整備份讀取完成、確認長度與 SHA256，記錄可驗證範圍；備份檔只留本機，已排除版本控制。
2. 確認安全啟動與 Flash 加密狀態、原廠應用版本、建置工具與相容的依賴版本。
3. 使用官方 StackChan-BSP 與 CoreS3 選板資訊；檢查初始化副作用。官方 `M5StackChan.begin()` 會啟用伺服供電並初始化運動控制，不可將其視為純螢幕初始化。
4. 首個測試韌體僅驗證螢幕與連線，不發出馬達動作指令。不得直接以一般 CoreS3 預設分割表覆寫原廠配置而不處理備份與校準資料。
5. 先編譯成功，再進行刷入與實機驗證；不能將建置成功等同硬體功能已通過。

## 官方還原路徑

M5Burner → 搜尋 StackChan → Only Official → 下載官方韌體 → 選取實際 COM 埠後燒錄。這是回到官方韌體的方式，不保證回復這台裝置原有帳號、設定及校準；保留完整本機備份。

進下載模式：依官方硬體文件，按住底部 RST 約 3 秒，綠燈亮起後放開；建議使用底座 USB-C。

## 來源

- https://docs.m5stack.com/en/StackChan
- https://docs.m5stack.com/en/arduino/stackchan/program
- https://github.com/m5stack/StackChan-BSP
- https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html
