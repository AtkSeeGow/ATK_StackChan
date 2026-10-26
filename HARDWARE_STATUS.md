# K151-R 硬體驗證

日期：2026-10-26。

## 2026-10-26 觸控完成後直接開始下一段

使用者回報加快馬達「沒問題」。觸控完成主按鈕現為「開始休息／開始專注」，單次 nextStart 完成切階段＋開始，成功回表情；Node 共用開始語音／燈效／馬達流程，網頁 next 不變。app 2,068,720 bytes，SHA256 `df28c6e96509a33871b0bab94a9251c1809f56a54bdc370d54eab14a682153f8`，只寫 0x20000，刷前舊／刷後新版 verify matched，編譯通過。Node 36/36 通過，服務已重啟；未替使用者觸發下一段，現場單擊操作與語音待確認。

## 2026-10-26 自動番茄鐘轉頭節奏

使用者同意加快開始／結束左右擺動。僅自動 gesture 使用 brisk：6 raw／60ms、端點停60ms（原3 raw／150ms、停200ms）；±15° 擺動排程約2.1秒，仍另保留1.5秒回正等待。幅度、中心、pitch off、24秒供電上限及手動測試速度不變；共用的 resume／最後30秒 gesture 同步加快。未量測實際位置或物理時間。

新 app 2,068,688 bytes，SHA256 `147ad1795a75aea662c125fc94b8aad3a685dcf39bc68c18aa2c4e43c048d361`，只寫 0x20000；刷前舊版、刷後新 app verify matched，編譯／constexpr 通過。尚待使用者觀察下一次事件動作、回正與異音，未額外開始／重設計時。

## 2026-10-26 觸控番茄鐘選單

最新依使用者要求移除右下提示文字，表情畫面任意處仍開選單；操作成功收到主機確認後回表情，重設保留二次確認，失敗／逾時留訊息。app `.tools/build/display-touch-return/DisplayProbe.ino.bin`，2,068,592 bytes，SHA256 `e3883fdd0e78946a18ed7c02f1312f06bc2b5c24ad15da5563dc67c92b096e35`；只寫 0x20000，刷前舊／刷後新 verify matched，編譯通過。Node 未變動，現場點擊與返回表情效果待確認。

首版使用者實測「點操作沒出現按鈕」，尚未通過。相機關閉、I2C 已交還且晶片識別正常，有一次 raw touch 但無該次座標。最新入口修正版 `.tools/build/display-touch-menu/DisplayProbe.ino.bin`，2,068,624 bytes，SHA256 `c00072dbcc6a4d5ce36b079f7ed27d97a646c32768f8217585242694f57de2d1`，只寫 0x20000，刷前舊／刷後新獨立 verify matched。改為表情畫面任意按壓開選單，不發計時指令；保留喚醒吞首觸與按住不連發。新增 press 座標日誌與 last_x/last_y 診斷。等待現場重新點擊確認，根因及各按鈕座標仍待核對。

現刷 `.tools/build/display-touch-controls/DisplayProbe.ino.bin`，2,068,432 bytes，SHA256 `5fd0388ff8543cc6c5ffb7e19acdf15a1ed8522c60454f1f5dd41d781f36555b`，只寫應用槽 0x20000，刷前舊／刷後新 verify matched。右下「操作」開選單，開始／暫停／繼續／下一段、重設二次確認、待機切專注／休息；黑畫面第一下只喚醒，按住不連發。直接讀 FT6336 首指座標並套用顯示旋轉，經認證 WebSocket 交主機執行，主機回結果且網頁同步。

Node 34/34 與韌體編譯通過，真實本機 WebSocket 整合測試涵蓋開始／暫停、去重與過期狀態拒絕。實機 Wi-Fi/WebSocket=1、running/focus、中心 −7°、audioReady=true、motionBusy=false、觸控 ID 正常。未擅自變更使用者的進行中計時；按鈕座標、繁中外觀與現場操作待驗收。相機占用共用 I2C 時需停止預覽才能操作觸控。

## 2026-10-26 螢幕閒置與觸控喚醒

最新背光關閉觸控驗收通過一次：使用者不操作網頁／鍵盤先觸碰，確認「立刻亮了」。紀錄 cause=raw_touch、brightness_ms=0、wake_to_draw_ms=55、max_poll_gap_ms=65、detections=3，確認此次真正由手指原始觸控喚醒。現有時序版未再重刷，仍只關背光、不進 MCU deep sleep。這是強制閒置路徑測試，真實等滿 30 分鐘與長期穩定性待驗證；先前五秒延遲未重現，未確認根因。

關背光版使用者仍目測五秒。現刷時序診斷版 1,471,312 bytes，SHA256 `8a8409f52fecd771e4a35906d700a9eddd3d018e7ff66a0efefa20a2cb4673e8`，只寫 0x20000，刷前舊／刷後新獨立 verify matched。USB 喚醒量測恢復背光 1ms、至 pushSprite 完成 55ms，休眠期間最大觸控取樣間距 64ms；此測試不能代替手指喚醒驗收。新增 cause 可區分 raw_touch/m5_touch/web_activity/usb/in_use。120 秒數值監看待回報；關背光手指延遲未修復，先前 raw detections=0 的醒來不能直接認定由觸控造成。

使用者已確認立即重繪版沒有延遲，授權嘗試關背光。現刷關背光候選 app 1,470,784 bytes，SHA256 `f247b1ae808c4f831704ee518b51db95133df4e74e774753d64b6c8944cbaec1`；僅 brightness 改 sleeping?0:90，保留觸控模式與喚醒強制重繪。刷前舊版／刷後新版獨立 verify matched，只寫 0x20000，編譯通過。已 D|sleep 待現場觸控回報，關背光版尚未通過驗收，真實閒置 30 分鐘仍未等待驗證。

使用者確認全黑保留供電版已能喚醒，但約五秒延遲。已修正喚醒後未失效的繪圖快取：redrawOnWake 強制同一輪重繪，避免等下一次動畫。最新 app 1,470,784 bytes，SHA256 `5d0014e720b6535d168caf52095257b1f62dcd8990b9829d4253c57f8268a223`；只寫 0x20000，刷前舊映像／刷後新版獨立 verify matched，編譯與 constexpr 檢查通過。已切黑畫面待實際延遲確認，不先宣稱低延遲驗收通過。保留 brightness=90，沒有啟動馬達。

亮屏中央按壓已讀到 12 次有效觸碰。最新全黑畫面候選 app 1,470,736 bytes，SHA256 `f885078e02db543420043c6aeb380920775b6a95106cdd0a22d6be21690731d2`，刷前舊版／刷後新版獨立 verify matched，只寫 0x20000。睡眠改為 fillScreen(0)／停重繪，保留 brightness=90 與既有觸控模式，移除入睡 touch wakeup 呼叫；這是候選診斷，不能先認定根因，也不等於關閉背光。實際黑畫面觸控喚醒與觀感待回報，真實 30 分鐘尚未等待驗證。

冷啟動後黑畫面觸碰仍未喚醒：chip/vendor 正常（0x64/0x11）、mode=0，累計 samples=1125、detections=0。已 USB 恢復 sleeping=false。正分離測試亮屏時的一般觸控是否有效，尚待使用者按住亮屏中央五秒後讀值；未新增刷機或馬達動作。

使用者完全關機重開後（未重刷），FT6336 chip=0x64、vendor=0x11、mode=1 恢復；同一輪 D|sleep 與 D|wake 之後識別也正常。已再次進黑畫面待現場觸控驗收；不能僅憑冷啟動恢復識別宣稱根因或喚醒已修好，先前識別歸零原因仍未知。

最新 app 為 `.tools/build/display-touch-bus/DisplayProbe.ino.bin`，1,470,720 bytes、SHA256 `6d663457a69af15a1cc71e4dbc46acb4e530e6a9f1c8fe7d5cf606e267a20c0b`；只寫 0x20000，刷前舊版／刷後新版 verify matched。使用者第三次主動掃描測試仍黑且 detections=0。共用 I2C 的 AW9523 ID=0x23、AXP2101 ID=0x4A 正常，SDA/SCL=1；FT6336 chip/vendor=0。強制重新建立 I2C 成功，但觸控 init=false。已恢復 sleeping=false，未初始化或觸發馬達。待完全關機再開機核對觸控初始識別，尚不可判硬體故障，也不可宣稱喚醒已修好。

最新實機觸控喚醒 **未通過**：初版及直接輪詢候選版都由使用者回報碰螢幕仍黑；USB D|wake 可恢復。現刷診斷版 1,470,240 bytes，SHA256 `9657de3f7f9fe229516f9510ddfa8faaa0e2255102d81be15386c471065f0303`，只寫 0x20000，刷前舊版及刷後新版獨立 verify matched。D|status 新增晶片／廠商／模式及累計取樣／觸碰次數；目前晶片及廠商讀值為 0，不能僅依 I2C API 回傳成功判為控制器正常。D|touch-active 可暫時切正常掃描模式作診斷，尚非根因修正。待現場新測試；先前五秒按壓的監看最終輸出未取回，無完整取樣結論。下方「待回報」為較早紀錄。

現行 app 1,469,360 bytes、SHA256 `c68dd775e6c14752c7e898c6260e88375bb90232f0bebea8cb8933ae2142779c`，只寫 0x20000，write hash／獨立 verify matched。閒置 1800 秒後背光設 0、停畫面重繪，觸碰恢復 90；計時 running／語音／馬達保持亮屏，背景 WebSocket／輪詢不算使用。進休眠時停止相機並還原共用 I2C，休眠期間保持觸控可讀。ACK 回報 screen_sleeping。未使用 MCU deep sleep，計時與連線繼續。

韌體 constexpr static_assert 已驗證 30 分鐘邊界、觸碰重置、相同活動 marker 不延長時間及 millis 溢位；Node 32/32、Python mock 5/5 通過。當時使用者正在休息計時，未為驗收而改變其計時狀態；實際等待 30 分鐘、背光觀感與手指觸控喚醒待使用者現場確認。保存 −7° 中心及其他馬達限制不變。

休息自然完成後以 USB D|sleep 強制走同一閒置路徑，實機回報 sleeping=true、idle_timeout_seconds=1800；已請使用者觸碰測試，結果待回報。沒有改計時或啟用馬達。此測試不等於實際等滿 30 分鐘。

## 2026-10-26 WebSocket 與獨立馬達任務

現行 app 1,468,160 bytes、SHA256 `2a8d8ebc9fe9f7ec6e225f140cc45ead3bc7cf665dbec3884bb975626f7c1030`，只寫 0x20000，write hash／獨立 verify matched。新增獨立 WebSocket 接收任務與馬達任務，I2C 共用資源以 recursive mutex 協調；語音／相機與馬達不重疊操作。番茄鐘預設改成 ±15°，網頁可保存 5～30°；保存中心 −7° 保留，pitch 仍停用。對稱往返 timeout 24 秒、結束 torque-off／VM off。

實測 resume 使用提前約 190 秒生成的 PCM，事件後 1 ms 入列，裝置回報播放完成；之後 motionBusy=true 期間 render_count 與 ACK 繼續更新，32 秒取樣保持 WebSocket 裝置連線。實際動作幅度、回正與異音仍待肉眼／現場確認，RX 未修復。沒有執行 ±50° 或 pitch。詳細預備語音、測試範圍及相依版本見 HANDOFF_5070.md 最新節。

## 2026-10-26 番茄鐘燈效與安全動作整合

現行統一回正等待版：1,377,440 bytes、SHA256 `aed812e351bf9d2353a0796be6ab073092707ee28b72ed04bdc003d7a763eb70`，只寫 0x20000，write hash 及獨立 verify 通過。手動微調／往返／自動番茄鐘共用最終目標重送及 1.5 秒到位等待；自動動作供電預算 5 秒。保存偏移 −7° 保留。使用者回報開始休息後未回正，此為待實機驗證的候選修正；未再次觸發動作。保存「轉圈」經澄清為網頁載入，保存本身不會送位移命令。

使用者回報網頁居中 ±1° 實機不動，先前 API completed 不能算物理驗收。最新到位等待候選版為 1,377,376 bytes、SHA256 `9a503ad8fed551646f78dba23fad804ffd6bee91952fcc7a926daa0b6173d727`，只寫 0x20000 且獨立 verify matched；最終目標重送四次並增加到位等待後斷電。回報加入 center_offset，主機核對目標；保存偏移 −10° 保留。根因尚未確定，等待使用者實機重測，RX 仍不可用。

現行為網頁居中微調版：1,377,120 bytes、SHA256 `6e99ae413e531caacc9fc5d5e66b9140cb6412faae7366018c8137b285b77758`，只寫 0x20000，write hash／獨立 verify 通過。Wi-Fi 指令支援每次 ±1° 居中微調（偏移限 ±15°）及 ±5°～±30° 單次往返；保存偏移在主機 SQLite，原廠 NVS 校準只讀。實機新 API 的 +1°／−1° 各一次皆回 completed／power off，回到 preview=0、saved=0。物理校正仍需使用者面向裝置觀察；RX 不可用。自動番茄鐘仍單側約 6.25°。

前一階段 ±30° 唯一一次手動測試命令完成：home 460、min 364、max 556、last_command 460、pitch off、power off；實際回正與異音待回報。±15° 已由使用者確認回正、無卡頓但不夠明顯。尚未執行 ±50°。

最新 ±15° 階段：使用者確認前次 6.25° 無卡頓／異音後，同意先做 ±15° 單次水平往返。app 1,375,792 bytes、SHA256 `fc7c955e5039ec77070fb448588ffe25c500911787ce15f45cf109c0c4815d2a` 只寫 0x20000，write 與獨立 verify 成功。唯一一次 `yaw-sweep-15` 回報 home 460、min 412、max 508、last_command 460、ok、pitch off、power off。手動命令供電上限 12 秒，自動計時仍單側 6.25°／3 秒。實際動作與回正、異音待使用者驗收；未進 ±30° 或 ±50°。

最新：使用者認為約 3° 太小並同意擴大後，已部署約 6.25° 單側往返版（home → +20 raw → home），pitch 停用、3 秒 timeout 保留。app 1,375,088 bytes、SHA256 `b6e3d5f4b847e039051b0819f0e37aaaff14ccf5b8955f7654f216eb841481cd`，只寫 0x20000 且 write／獨立 verify 通過。Wi-Fi 已恢復；唯一一次手動測試回報 home 460、peak 480、ok、pitch off、power off，人工動作觀察待回報。

使用者已確認看見呼吸燈，並確認馬達周圍一直淨空。首次開始專注測試已送出，裝置 ACK 為 running／1499 秒、effectId `8adf0ada`；實際 yaw 往返與異音觀察待回報，ACK 不能當作動作完成證明。未重送動作。

已部署 protocol v2 韌體：裝置依計時狀態產生低亮度 RGB 呼吸／警示燈；start／resume、專注剩餘 30 秒及 completed 以唯一 cue ID 傳送一次性動作。相同 ID 不重複，cue 15 秒到期，語音／錄音／相機占用時不動作，動作有 20 秒冷卻。自動馬達只使用已人工驗證的 yaw home raw 460 → +10 raw（約 +3.1°）→ home；pitch 與 yaw 負方向仍禁止。每次動作後 torque-off、VM off，另有 3 秒供電 timeout。

app 為 1,374,944 bytes、SHA256 `0094b00d8a2dd088ebb1058f1f7f9acc0ba271014d9f89f75d50a530d8368ff9`。刷前備份 `.tools/recovery/pre-timer-effects-20261026.ino.bin` 為 1,373,120 bytes、SHA256 `ca425325e7d7002614604b76049124e43948e6027c7ece7369228819ddea938c`，與前版一致。esptool 5.1.0 ROM 模式只寫 0x20000，write hash 與獨立 verify digest matched；未動其他分割區。啟動後 protocol v2 Wi-Fi ACK 為 connected、completed／0 秒／teasing、`audioReady:true`、`effectId:"00000000"`。現有狀態沒有一次性 cue，故重啟未驅動馬達；完成燈效與首次 start 動作待使用者現場驗收。

## 2026-10-25 馬達安全範圍探針（只讀探針未取得有效位置）

官方 K151-R 使用串列回授伺服（UART1 1 Mbps、TX G6／RX G7；yaw ID 1、pitch ID 2），不是一般 PWM 舵機；pitch 官方建議工作範圍 5°～85°。為保留原廠 NVS，未使用可能寫入預設校準值的 `M5StackChan.begin()`，而以官方 M5StackChan 1.1.1 的底層 PY32 IO expander 與 SCSCL 類別實作 `MotorSafety.h`。

安全探針開機不初始化、不供電、不動作、不寫 NVS／伺服 EEPROM。命令限定為只讀 probe、立即 off、yaw 相對首次 probe 基準約 ±3.1°及回基準；第一階段沒有任何 pitch 動作。每次命令都先解除兩軸扭力，動作結束解除扭力並關伺服電源，另有 3 秒硬性超時。

初版 1,368,704 bytes、SHA256 `2a0c1b7fc1b2814c39df94fa6d52e37285bebb01371bf133287bc11b738912c9` 的 USB 命令在 Wi-Fi 啟用時會被主迴圈略過，因此最初 probe／off 逾時並未執行任何馬達操作。修正成獨立 USB 安全命令緩衝區後，app 1,368,768 bytes、SHA256 `e940e19ab90d6e21c4d16c67edeb708d5ca7b994b5b7ff2d489a3c47786796ed` 已只寫 0x20000，write hash 與獨立 verify-flash digest matched；初版讀回備份為 `.tools/recovery/pre-usb-motor-command-fix-20261025.ino.bin`，大小與雜湊吻合。

使用者確認實機淨空後，`M|off` 成功回覆 `ok:true`、`power:off`。首次且唯一一次 `M|probe` 不含位移，回覆 `ok:false`、`reason:invalid_servo_position`、`power:off`。未送出任何 yaw／pitch 位移命令；目前禁止進入 ±3° 測試，先等待使用者回報是否有異音或非預期動作，並診斷伺服通訊／讀值。

使用者確認沒有移動、喀聲或持續嗡鳴。診斷版 app 1,369,280 bytes、SHA256 `268387eadbb9e76975ff5666589d9d40a443a75aea23af497510239e918fbb9c` 已只寫 0x20000，write hash 與獨立 verify-flash digest matched；其餘分割區與 NVS 未動。再次先 `off` 成功，再執行一次無位移 probe：yaw/pitch ping 均 `-1`、解除扭力 ACK 均 `0`、raw position 均 `-1`，最後 `power:off`。兩軸皆無 UART 回覆，並非單軸角度超界。下一步先做完整關機／開機以重置獨立伺服電源與匯流排，淨空後最多再做一次只讀 probe；若仍相同，停止軟體測試並檢查伺服供電／內部線材或以官方 Servo Test 診斷，禁止送位移命令。

使用者已長按電源完成真正關機、等待後重新開機。重啟後先 `off` 成功，最後一次無位移 probe 仍得到兩軸 ping `-1`、torque-off ACK `0`、raw position `-1`，並回覆 `power:off`。安全範圍測試已停止，整個流程未送出任何 yaw／pitch 角度目標。完整電源循環未恢復伺服通訊，後續先查 VM 電源與內部線材，或保留目前 app 後以官方 Servo Test 區分硬體與自訂韌體問題；不得繼續盲目重試或動作測試。

使用者決定改做原廠 Servo Test。原廠 16 MB 完整備份再次核對 SHA256 `15b0661bccd3ca90ad5f653556e85fa83cfd180667adcefa2a9aaf9fc6822ac7`；抽出的 ota_0 為 5,177,344 bytes、SHA256 `97b176049d75a3e1851ccc738003b62b3b3938c636f7edb2ba287296cf64ab5b`，image-info 確認 `stack-chan` 1.4.4、ESP-IDF v5.5.4，checksum 與 validation hash 有效。診斷版已保留為 `.tools/recovery/motor-diagnostic-20261025.ino.bin`。原廠 ota_0 已只回寫 0x20000–0x50FFFF，write hash 與獨立 verify-flash digest matched；NVS、otadata、assets、分割表及其他槽未動。刷寫後維持 bootloader，尚未啟動原廠程式；須由使用者再次確認淨空後才手動啟動並在原廠 Settings 內選 Servo Test。

使用者確認淨空後啟動原廠程式，在「環境設定」完成官方首次啟動 Servo Test，回報動作正常，啟動時沒有馬達異音。已實證兩顆伺服、VM 供電、UART 實體鏈路與機構在原廠 1.4.4 下正常；先前自訂診斷版雙軸 ping／raw 皆無回覆屬自訂韌體初始化或匯流排整合問題，不能歸咎硬體／接線。目前裝置保留原廠韌體，尚未回刷自訂表情／語音應用。

依使用者要求繼續比對後，修正相機釋放共用 `M5.In_I2C` 後舊程式仍沿用 IO expander ready 快取的錯誤；每次安全命令現會停止相機、重建 I2C、重新探測 PY32。也把馬達路徑調成原廠次序：VM_EN high、等待 250 ms、再建立 UART1，關閉 VM 後刪除 UART driver。順序修正版 1,369,584 bytes、SHA256 `012375efce29984b27235c2373e7139115ca0aca766c931b9881e60820c49358` 已只寫 0x20000 且 verify digest matched；`off` 成功，無位移 probe 仍是兩軸 ping／raw `-1`，並安全斷電。

現行診斷版 1,370,768 bytes、SHA256 `f3c5f73ca643fc81b82c43f95b0d3e3b3c1e9b061c91660d039f3b81a16d0413` 已只寫 0x20000 且 verify digest matched。新增 `M|raw` 只發兩個標準 Ping，不開扭力、不寫校準、不送角度；INA226 量到 VM off/on 時 bus `4.1588/4.1562 V`、shunt `-0.000050/0.000185 V`，證明 VM 開啟後有新增負載，但 GPIO7 RX 對 yaw/pitch 各等待 100 ms 皆為 0 byte。這排除高階 parser timeout，問題位於自訂 Arduino 環境的 UART 腳位／路由初始化層；原廠 Servo Test 已證明硬體鏈路正常。命令最後回覆 `power:off`，目前仍未送出任何位置目標。下一步需真正斷電冷啟動後只重跑一次 raw probe；若仍無 byte，使用最小原廠 BSP 初始化探針隔離 M5Unified 與完整應用整合，不得直接進入 ±3° 動作測試。

使用者完成冷啟動後，raw probe 仍為兩軸 0 RX byte，且 VM 負載變化重現。最小 `ServoBspProbe`（無 Wi-Fi／相機／音訊／動畫、無 `Motion.init()`）以 Core 3.3.10 編譯為 538,224 bytes、SHA256 `14a90eced6e01f57b1b298086d8a0af6ae47446af9857e4d9942f5bd3fb9ab08`，只寫 0x20000 且 verify matched；結果仍是兩軸 ping／位置 `-1`。完整應用不是根因。

隔離測試 Arduino Core 3.2.6 與 3.3.7 時，應用映像與 flash digest 都有效，但兩版連最早的純 USB `M|off` 都無回覆，故未允許其執行馬達探針，不能把它們當作 UART A/B 結果。回到可觀測的 3.3.10 後，raw 路徑改採實機驗證過的 ESP-IDF ScsBus UART 配置（RX 256、TX buffer 0 同步傳送）；完整表情／語音 app 1,370,880 bytes、SHA256 `e293e570c9c6e732921a8cfc75aa2209eb84d92d65f164b8aeec6d4b631de35b` 已只寫 0x20000、verify matched，`off` 成功。同步 raw probe 仍為兩軸 0 RX byte，bus `4.1625→4.1588 V`、shunt `-0.000050→0.000185 V`，最後 `power:off`，因此 FTServo queued-TX 不是原因。

原廠 Servo Test 與官方 Arduino 範例均可直接 `goHome()`／`move()`；原廠測試動作正常證明 VM、TX、伺服及機構可被驅動，但不必然證明 RX 回讀正常。先前「完整 UART 實體鏈路正常」應收斂成「至少 TX 驅動鏈路正常」。自訂韌體至今未送出任何位置目標。若繼續，安全測試需改成原廠已回 home 後的開迴路單軸低速約 3°動作，並在執行前重新確認淨空及無異音；不得假稱已有閉迴路位置基準。

目前裝置運行完整 3.3.10 表情／語音 app，.199 Node 已恢復；Wi-Fi ACK、completed／teasing、`audioReady:true` 驗證通過。馬達電源在最後一次 raw probe 結束時為 off，尚未進行開迴路位移。

使用者再次確認周圍淨空後，安全測試版 app 1,373,120 bytes、SHA256 `ca425325e7d7002614604b76049124e43948e6027c7ece7369228819ddea938c` 已只寫 0x20000 且 verify matched。唯一一次開迴路 yaw 測試從既有 NVS 只讀 home raw 460，pitch 全程 torque-off，yaw 逐步低速到 raw 470（約 3.1°）再回 460；韌體回報命令完整送出、`motion_verified:false`、`power:off`。RX 不可用，需以使用者現場觀察判定是否實際小幅往返及有無異音；回報前禁止重試、擴角或測 pitch。

使用者已確認該次 yaw「有小幅往返」。這通過自訂韌體 VM／TX、yaw ID 1、home raw 460 與約 3.1°低速往返的人工動作驗證；結束後 torque-off、VM off。RX、pitch 與更大角度仍未驗收，且尚待使用者明確確認有無異音，故暫不進行下一次動作。

## 2026-10-25 Sprite Sheet 表情動畫與待機環顧

依 4×7 Sprite Sheet 將螢幕動畫重寫為固定四格語言：neutral 眨眼、happy 彈跳／壓縮、teasing 同步眨眼與偏嘴、concerned 眉眼、依播放 PCM 峰值驅動的四段嘴型、收音擴散波紋，以及正視→看左→回正→看右的 neutral 待機環顧。仍只用 M5Canvas 幾何圖形、不使用 assets 分割區、不初始化馬達。參考稿為 `design/expression-sprites.png`（512×448、4×7、每格 128×64、透明 PNG）。

使用者實機回報 teasing 的刻意單眼眨眼呈現大小眼，已將該列所有畫格改為左右眼同寬、同高、同垂直中心，動畫為正常→雙眼半閉→雙眼閉合→正常，偏嘴維持角色感。對稱修正版 app 1,348,496 bytes、SHA256 `4768e4e0547e47bb457abab51731a639eb005b86981998bd4ec900c957df353b`；刷前從 0x20000 備份前版至 `.tools/recovery/pre-eye-symmetry-20261025.ino.bin`，1,348,528 bytes、SHA256 `b1e54e3abeee1ab38af28280ea36dee168bd6e03d6cd2bbfb5b4f9171845ad87`，與前版交接值一致。esptool 5.1.0 只寫 0x20000，write hash 與獨立 `verify-flash` digest matched，watchdog reset；Wi-Fi ACK 恢復且 `check-device.mjs running` 通過。實機視覺仍待使用者確認。

Windows 原生 Espressif 2601 版編譯器因 `Illegal System DLL Relocation` 無法啟動；重開機及官方 SHA256 正確的全新 64／32-bit 工具鏈皆相同。未降低 Windows 防護，改在同一台 .199 的本機 Ubuntu WSL 以 M5Stack core 3.3.10、M5Unified 0.2.27、M5GFX 0.2.34 編譯。新 app 1,348,528 bytes，SHA256 `b1e54e3abeee1ab38af28280ea36dee168bd6e03d6cd2bbfb5b4f9171845ad87`。

刷寫前已用 esptool 5.3.0 ROM `--no-stub` 從 0x20000 讀回原 app 至 `.tools/recovery/pre-sprites-20261025.ino.bin`；1,347,664 bytes、SHA256 `e5f4b20c8db8c8517d6298af6ad6a379bf6fb3880d4da2d89f3aefdf3199250d`，與既有交接值一致。新 app 僅寫入 **0x20000**，write hash 與獨立 `verify-flash` digest matched，watchdog reset；未動其他分割區或 eFuse。Node 服務恢復後 Wi-Fi ACK、completed／0 秒／teasing、`audioReady:true`，`check-device.mjs completed` 通過。實際動畫辨識度及嘴型／波紋觀感仍待使用者肉眼確認。

## 2026-10-25 整合音訊恢復與螢幕動畫

使用者明確同意後，已使用 esptool 5.3.0 ROM 模式將新版 app binary **只寫入 0x20000**；沒有 erase 全片，沒有寫 bootloader、partition table、otadata、NVS、assets、coredump 或 eFuse，也沒有初始化馬達。binary 1,347,664 bytes，SHA256 `e5f4b20c8db8c8517d6298af6ad6a379bf6fb3880d4da2d89f3aefdf3199250d`。write-flash 內建 hash 通過，另行 `verify-flash` 讀回 1,347,664 bytes，digest matched，之後 watchdog reset。

新版啟動後 Wi-Fi ACK 自動恢復，主機取得 `audioReady:true`；進行中的 focus timer 與裝置差約 2 秒，既有 `check-device.mjs running` 通過。韌體新增播放後 speaker／mic／PSRAM／I2C 恢復與 `audio_ready` telemetry，以及不使用馬達的螢幕動畫：待機眨眼、happy 輕跳、teasing 眨眼、concerned 眉眼、TTS 嘴型、提示音與收音聆聽動畫。動畫 redraw 不增加語意 `render_count`；待 idle／paused 後仍需補 stable render 檢查。**使用者實際確認看得到動畫，但覺得效果不明顯**；後續可加大位移、嘴型或波紋幅度，但本輪依要求先停在目前版本。另「R2 播放後不重設直接 STT」仍待真人驗證，不能僅憑 audioReady 宣稱音訊恢復問題已完全修好。

## 2026-10-24 語音播放接續

最新：.199 已成功編譯並只刷寫 0x20000，應用 1,346,144 bytes，SHA256 `5ae046bba67bedae4ebfea946c2dd467127ddaeee96210051cb3c84537c059ff`，寫入 hash 通過並恢復 Wi-Fi ACK。使用者確認固定中文合成句清楚、音量 208／加強可接受。重播新 ID、舊 ID 拒絕及播放後相機恢復已驗證；其餘壓力／失聯測試待補。上一版應用在 `.tools/recovery/pre-tts-20261024.ino.bin`，原廠分割表及備份保留。下段為刷寫前交接歷史。

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
