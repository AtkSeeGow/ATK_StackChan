# StackChan 控制站與 AI 語音站交接紀錄

正式名稱與目前主機位置以 [SERVICE_MAP.md](SERVICE_MAP.md) 為準：控制站負責網頁／計時／裝置；AI 語音站負責對話／STT／TTS。歷史 `.199`／`.100` 僅代表當時部署位置，後續討論使用角色名稱。檔名保留以維持既有接手入口。

更新：2026-10-26。接手時先核對此文件，再讀 `SPEECH_SETUP.md`／`TTS_SETUP.md`。GPU STT 與裝置五秒中文基本端到端驗收已通過；.199 已編譯刷入 TTS 韌體，使用者確認裝置中文清楚、音量可接受。下方較早的「未部署」描述為歷史紀錄，以最新實測節為準。

## 目前站台分工與驗收清單（2026-10-26）

本節依部署紀錄與使用者回覆整理；本次只更新文件，沒有重新檢查 .100 即時程序或重跑實機測試。下方較早的「未部署／未選聲」不是現況。

| 位置 | 服務／功能 | 用途 |
| --- | --- | --- |
| AI 語音站（目前192.168.0.100、RTX 5070） | Ollama，11434 | 對話回覆、番茄鐘情境台詞 |
| AI 語音站 | speech API，8001；CUDA/small STT | GPU 語音辨識 |
| AI 語音站 | R2 Qwen3-TTS GPU 常駐 worker | 角色語音合成，經同一個8001 API呼叫，使用獨立環境 |
| AI 語音站 | Windows Hanhan CPU TTS | R2 失敗／逾時備援，在同一服務內處理 |
| 控制站（目前192.168.0.199） | Node，3000；SQLite、WebSocket | 網頁、計時、設定、裝置連線、語音預備排程及 PCM 記憶體快取 |
| 控制站 | 相機辨識 worker | 本機在席判斷，影像僅記憶體處理 |
| StackChan | 自訂韌體 | 觸控、表情、背光、收音／播放、燈效及受限馬達動作 |

.100 在 repo 根目錄使用 `.\services\speech\start.ps1 -Device cuda -TtsEngine character` 啟動既有語音環境，沿用私有設定與模型，不重做安裝或配對。省略 TtsEngine 時預設是 windows，不能當成 R2 已啟用；已有8001服務時不要重複啟動。Ollama 維持原本啟動方式，不把 .199 服務整套搬到 .100。新環境須重新檢查 IP、埠、worker 與真實推論，health 成功不代表整合驗收。

已確認：R2 中文清楚、角色感及音量可接受；機身呼吸燈可見；關背光後手指立即喚醒一次（raw_touch，至重繪55ms）；加快馬達節奏獲使用者回覆「沒問題」。最近 Node 36/36、韌體編譯／應用槽校驗通過，不能替代下列實機驗收。

| 狀態 | 待驗收項目 | 需要的主機 |
| --- | --- | --- |
| 待確認 | 最新「開始休息／開始專注」一次切換並開始、返回表情 | .199＋裝置；語音需 .100 |
| 待完整跑一輪 | 觸控開始／暫停／繼續／重設二次確認／待機切階段及網頁同步 | .199＋裝置 |
| 待實測 | 真正閒置1800秒關背光、多次睡醒與長時間觸控穩定性 | .199＋裝置 |
| 待完整驗收 | 專注／休息各事件的語音預備、台詞與實際等待時間 | .100＋.199＋裝置 |
| 待回歸 | R2 播放後不按 RST 直接真人 STT，連續多輪 | .100＋.199＋裝置；錄音僅記憶體 |
| 待實測 | Ollama/STT/R2 同時負載、長句及逾時回退 | .100 為主，.199 觀察整合 |
| 待完整驗收 | 居中保存跨動作／重開機、完整專注→休息→專注流程 | .199＋裝置；角色語音需 .100 |
| 待實測 | Wi-Fi、語音服務及下載中斷後恢復，不重播舊指令 | .100＋.199＋裝置 |
| 待實測 | 數小時運作、實際離席／側臉／光線變化下在席準確率 | .199＋裝置；語音壓力需 .100 |

尚未完成或已知限制：兩台主機的服務開機自動啟動與異常重啟、自訂韌體馬達 RX 位置回讀、相機預覽與觸控共用 I2C 的同時操作（目前需先停止預覽）。表情細緻度依使用者先前決定暫時保留；R2 不需重選，未要求的 ±50°／俯仰動作不列為必做驗收。

## 觸控下一段一次開始（2026-10-26，已部署）

- 使用者對加快馬達回覆「沒問題」，並指出觸控下一段還需重開選單按開始。已將完成狀態主按鈕改為「開始休息／開始專注」，發 nextStart：主機先驗證上一段完成，再同一次處理切階段＋開始；成功後依既有流程返回表情。網頁原 next 保留只切換行為。performTimerAction 將 nextStart 的角色台詞／燈效／馬達與語音準備統一視為新階段 start，保留已預備快取。
- 新增完成輪數不重複計數、兩方向切換立即 running、未完成不能 nextStart、觸控重送不二次切換測試；完整 Node 36/36 通過，韌體編譯／constexpr 通過。app `.tools/build/display-next-start/DisplayProbe.ino.bin`，2,068,720 bytes，SHA256 `df28c6e96509a33871b0bab94a9251c1809f56a54bdc370d54eab14a682153f8`；刷前已驗證加快馬達版，只寫 0x20000，write hash／獨立 verify matched。.199 Node 已重啟沿用資料與設定，未替使用者開始下一段；新按鈕現場操作與新階段開始語音仍待確認。

## 番茄鐘轉頭節奏加快（2026-10-26，已部署）

- 使用者回報開始／結束動作鈍慢，確認希望動作俐落、保留幅度與回正等待。supervisedYawSweep 新增 brisk 參數，僅 BodyMotionTask 自動 gesture 使用：步距 3→6 raw、步間 150→60ms、每段停留 200→60ms；±15° 擺動排程由約 10.2 秒降至 2.1 秒，非實際位置量測。最終 settleYaw 四次重送＋500ms（共1.5秒）、供電24秒上限、pitch off、保存中心與幅度均保留；手動往返／居中維持舊節奏。此自動 gesture 亦供 resume 與最後30秒提示共用，故一併變快。記錄 op=timer_yaw_gesture。
- app `.tools/build/display-brisk-cue/DisplayProbe.ino.bin`，2,068,688 bytes，SHA256 `147ad1795a75aea662c125fc94b8aad3a685dcf39bc68c18aa2c4e43c048d361`；編譯／constexpr 通過，刷前原觸控返回版與刷後新 app verify matched，只寫 0x20000。Node 未改未重啟，未替使用者重設或觸發計時。新節奏物理速度、回正、異音待下次事件人工確認，RX 仍未回讀，不聲稱到位已驗證。

## 裝置觸控番茄鐘操作（2026-10-26，已部署、待現場點擊驗收）

- 依使用者要求移除右下「點畫面操作」文字，仍可點表情畫面任意處開選單；計時操作收到主機 C|id|ok 後自動返回表情，失敗／逾時留選單顯示訊息。重設第一次仍留選單做二次確認，返回／關閉直接回表情。已部署 `.tools/build/display-touch-return/DisplayProbe.ino.bin`，2,068,592 bytes，SHA256 `e3883fdd0e78946a18ed7c02f1312f06bc2b5c24ad15da5563dc67c92b096e35`；編譯／constexpr 通過，刷前舊映像與刷後新版獨立 verify matched，只寫 0x20000，Node 未改未重啟。介面修改後的實際觀感與按鈕操作仍待現場確認；使用者本輪未明確回報上一版各按鈕命中結果，不當成全部已驗收。

- 使用者回報點「操作」未出現選單，不能判首版已通過。診斷讀到 camera=false、camera_released=false、chip/vendor 正常、raw detections=1；尚未取得該次座標，根因未定。已把入口由底部 y>=210 改為表情畫面任意有效按壓即開（開選單不發計時指令），保留睡眠第一下吞掉及按住不連發；新增 touch_press 座標記錄、D|status 的 last_x/last_y，供後續核對按鈕座標。新 app `.tools/build/display-touch-menu/DisplayProbe.ino.bin`，2,068,624 bytes，SHA256 `c00072dbcc6a4d5ce36b079f7ed27d97a646c32768f8217585242694f57de2d1`；編譯／constexpr 通過，刷前舊版及刷後新版 verify matched，只寫 0x20000。僅改韌體入口與數值診斷，Node 未改未重啟。待使用者點亮著的表情畫面確認選單；後續各按鈕物理座標與命中仍未驗收。

- 使用者確認先放番茄鐘操作，不含錄音／播放。畫面右下「操作」開啟繁體中文大按鈕選單；依狀態提供開始／暫停／繼續／下一段，另有重設（三秒內再次按確認）、待機時改為專注／休息、返回表情。完成後「下一段」只切換到準備狀態，還需按開始；遵循既有網頁規則。黑畫面第一下只喚醒，須放開再點才操作；按住不連發。未接上 WebSocket 時不能操作，不在裝置離線自行計時。
- FT6336 直接輪詢擴為五 bytes，取得首指座標並用 M5.Display.convertRawXY 套用旋轉。TouchControls.h 處理選單／按壓邊緣／等待結果。具唯一 ID、session、預期 phase/status 的 timer_control 經既有認證裝置 WebSocket 送主機；device-timer-control.mjs 有限去重 64 筆、拒絕過期狀態及非白名單操作，回 C|id|結果。逾時五秒只顯示未確認，不重送或假稱成功。與網頁共用 performTimerAction，保留語音預備、角色台詞、燈效、馬達提示與忙碌互斥；主機統一持久化並推送同步。
- app `.tools/build/display-touch-controls/DisplayProbe.ino.bin`，2,068,432 bytes（加入繁中 efontTW_16），SHA256 `5fd0388ff8543cc6c5ffb7e19acdf15a1ed8522c60454f1f5dd41d781f36555b`。刷前既有時序版 verify matched，只寫 0x20000，write hash／獨立 verify matched。Node 完整 34/34，含真實本機 WebSocket start/pause、重送 ID 不重設 deadline、過期狀態拒絕及網頁 API 同步；韌體編譯與 constexpr 通過。首次沙箱測試的四項 EACCES 已在允許本機連線環境重跑通過，非產品失敗。
- .199 服務本輪 PID 18488；重啟保留 running/focus 與保存中心 −7°。新 app 實機 ACK connected=true、WebSocket browser=1/device=1、audioReady=true、motionBusy=false；觸控 ID 0x64/0x11 正常。未替使用者開始／暫停實機計時或觸發馬達。現場選單外觀、座標與按鈕動作仍待使用者確認；相機占用共用 I2C 時仍無法讀取觸控，需停止預覽，未在本階段改相機資源架構。

## 暫停語音預備與 30 分鐘螢幕閒置（2026-10-26，已部署）

- 最新實測通過一次「背光關閉→手指觸控立即亮屏」：使用者依指示先不碰網頁／鍵盤，回報「立刻亮了」。數值紀錄確認 cause=raw_touch、brightness_ms=0、wake_to_draw_ms=55、max_poll_gap_ms=65；raw detections 從 0 增至 3，排除該次由網頁操作觸發。仍用上述 display-wake-timing 韌體，未再重刷；保留 30 分鐘閒置關背光、觸控強制重繪。這次是 D|sleep 強制相同路徑，真實等待 1800 秒與長時間穩定性尚未驗證；之前五秒觀察未重現，原因仍未定，不可宣稱每次反應均已量測。數值監看於啟動 120 秒後自動結束並釋放 COM4。

- 關背光版由使用者回報仍約五秒延遲。隨後狀態 sleeping=false、raw detections=0，不能排除 M5.Touch 或網頁活動喚醒，亦不得直接判為背光硬體延遲。部署僅增加喚醒原因／時序紀錄的 `.tools/build/display-wake-timing/DisplayProbe.ino.bin`，1,471,312 bytes，SHA256 `8a8409f52fecd771e4a35906d700a9eddd3d018e7ff66a0efefa20a2cb4673e8`；刷前舊版／刷後新版 verify matched，只寫 0x20000，編譯通過。實際 USB sleep→wake 測得 cause=usb、brightness_ms=1、wake_to_draw_ms=55、max_poll_gap_ms=64；這是程式／USB 路徑，不是手指反應時間。已啟動 120 秒數值監看（COM4；只記相關 JSON 至 .tools/touch-wake-watch.jsonl，不含影像或錄音），待使用者觸碰且先不操作網頁／鍵盤來分辨來源。仍未解決關背光的手指延遲。

- 使用者確認立即重繪版喚醒「沒延遲了」，並要求嘗試關背光。已保留 redrawOnWake 及不呼叫 touch()->wakeup()，僅將亮度切回 sleeping?0:90，單獨驗證背光關閉。新 app `.tools/build/display-backlight-off/DisplayProbe.ino.bin`，1,470,784 bytes、SHA256 `f247b1ae808c4f831704ee518b51db95133df4e74e774753d64b6c8944cbaec1`；編譯／constexpr 通過，刷前已驗證立即重繪版，僅寫 0x20000，write hash 及獨立 verify matched。已執行 D|sleep，待使用者確認實際背光與觸控喚醒；尚不能判定背光關閉版通過。馬達與 Node 未改。

- 使用者確認保留供電的全黑版可觸控喚醒，但目測約延遲五秒。檢查發現 drawScreen 快取仍認為上一幀已顯示，待機同表情時會等下一次動畫變化才 pushSprite（neutral cycle 9 秒），足以造成數秒黑屏。新增 redrawOnWake：sleeping→awake 時設旗標，略過 100ms 排程與畫面快取，pushSprite 後才清旗標。只保證程式路徑同一輪主迴圈重畫，未量測實際觸碰至顯示延遲。已編譯部署 `.tools/build/display-wake-redraw/DisplayProbe.ino.bin`，1,470,784 bytes，SHA256 `5d0014e720b6535d168caf52095257b1f62dcd8990b9829d4253c57f8268a223`；刷前舊版／刷後新版 verify matched，只寫 0x20000，constexpr 時鐘檢查及 diff check 通過。已切黑畫面待使用者確認反應；仍保留 brightness=90，非背光斷電。

- 亮屏五秒按壓測試成功偵測：samples=1245、detections=12、chip=0x64/vendor=0x11、mode=0、sleeping=false。故改測保留顯示供電及既有觸控模式、僅 fillScreen(0) 停重繪的黑畫面候選；同時移除入睡時 touch()->wakeup()，尚不能區分背光關電與模式切換哪個造成問題。此版保留 brightness=90，黑色 LCD 仍可能有背光，不等於真正關閉背光或省電驗收。已編譯及部署 `.tools/build/display-black-touch/DisplayProbe.ino.bin`，1,470,736 bytes、SHA256 `f885078e02db543420043c6aeb380920775b6a95106cdd0a22d6be21690731d2`；刷前舊版 verify matched，只寫 0x20000，write hash 與獨立 verify matched。進黑畫面後實際觸控喚醒待回報；未改 Node／語音／馬達，時鐘 constexpr static_assert 編譯通過。

- 冷啟動後的新黑畫面觸碰測試仍失敗。回讀 chip=0x64、vendor=0x11、mode=0、samples=1125、detections=0、sleeping=true；其他 I2C ID 正常。已 D|wake 並收到 sleeping=false。晶片正常識別時也讀不到觸碰，故不能把識別恢復當成喚醒修復。下一步改為亮屏中央按住五秒，只檢查一般觸控讀值，待使用者回報。

- 使用者完全關機重開後，現有匯流排診斷版讀到 FT6336 chip=100（0x64）、vendor=17（0x11）、power_mode=1；AW9523=0x23、AXP2101=0x4A。未重刷。D|sleep 後 chip/vendor 仍正常，D|wake 後亦正常且 sleeping=false；故本次關背光未重現識別歸零。已再進 D|sleep 請使用者觸碰驗證，結果待回報。冷啟動恢復識別不等於根因已修復，先前歸零原因及長時間穩定性仍未知。

- 最新診斷結果：使用者在主動模式再次按住中央五秒仍黑，累計 samples=1003、detections=0；已 D|wake 恢復。再部署 `.tools/build/display-touch-bus/DisplayProbe.ino.bin`，1,470,720 bytes、SHA256 `6d663457a69af15a1cc71e4dbc46acb4e530e6a9f1c8fe7d5cf606e267a20c0b`，刷前舊版及刷後新版 verify matched，只寫 0x20000。新增 touch_bus 與 D|touch-reinit（無馬達初始化）。停相機後 camera_released=false、AW9523 ID=35（0x23）、AXP2101 ID=74（0x4A）、SDA/SCL 均高；觸控 chip/vendor/mode 仍 0。release 後明確 begin(I2C_NUM_1,12,11) 回 true，M5.Display.touch()->init() 回 false。已再 D|wake 並確認 sleeping=false。故非單純畫面亮度判斷或整條 I2C 斷線，觸控初始化失敗根因仍未知，不可判硬體損壞；下一步需完全關機再開機，核對初始觸控 ID。原廠 firmware/main/hal/board/stackchan.cc 的 ReadControllerVersion 也要求 cipher/vendor 非 0：https://github.com/m5stack/StackChan/blob/main/firmware/main/hal/board/stackchan.cc 。暫不請使用者再重複按壓。此版僅診斷，尚未修復喚醒。

- 觸控驗收未通過：使用者分別在初版與直接讀 FT6336 TD_STATUS 的候選版回報觸碰仍黑畫面；D|wake 可恢復亮度。後續已部署診斷版 `.tools/build/display-touch-diagnostic/DisplayProbe.ino.bin`，1,470,240 bytes，SHA256 `9657de3f7f9fe229516f9510ddfa8faaa0e2255102d81be15386c471065f0303`；刷前候選版 verify matched，只寫 0x20000，write hash 與獨立 verify matched。新增累計 samples／detections、chip／vendor／power_mode，以及僅診斷用 D|touch-active（0x00/A4/A5 寫 0，無 NVS 操作）。實測亮屏與停相機後黑畫面時 chip/vendor/mode 均 0，detections=0；readRegister 的成功不能當作晶片有效識別或觸控驗收。先前 45 秒監看程序的最終輸出未取回，不得宣稱使用者按住五秒已被完整取樣或確認零觸控。最新主動掃描觸碰測試待回報，真實 30 分鐘等候亦未驗證。

- 使用者回報開始後按暫停沒有預備音訊。已確認舊 planner 未排 pause，且 pause handler 清空快取；實際該次 source=timer-generated、enqueueDelayMs=12340。新增 `timer-voice-plan.mjs`：待機／上一段完成時預備目標階段的 start、pause、resume、completed；執行中持續預備 pause／resume，最後 120 秒補結束；暫停不再失效同一階段快取，reset／switch／settings 仍失效。pause 台詞也要求呼應專注／休息與暫停語意。
- 網頁顯示開始／暫停／繼續／結束四個準備狀態。已備妥音訊在事件函式中先同步取出，再處理下一階段預備；尚在生成且正被事件使用的 entry 暫時 pin，避免預備下一階段擠掉當次播放內容。常態四份預備＋執行中事件暫存，只在記憶體，不保存錄音／音訊。首次冷啟動仍須合成時間，未 ready 不保證立即播放。
- 使用者要求閒置 30 分鐘黑畫面、觸控亮屏。新增 ScreenIdleClock／ScreenIdle：1800 秒沒有活動則背光 0、停止畫面重繪，觸碰恢復原 90 亮度；無 deep sleep，Wi-Fi／語音／計時仍存活。計時 running、音訊或馬達動作視為使用中，保持亮屏；待機／暫停／完成才計算閒置。網頁初次開啟、點擊、鍵盤／focus 透過節流的 /api/activity 回報活動，使用者操作 POST 也更新 marker；GET 輪詢／WebSocket 推送不延長閒置。
- 相機占用共用 I2C 時，進入黑畫面前會停相機並恢復 M5 I2C，確保 Touch 可讀；休眠期間不重啟相機，醒後依既有主機設定恢復。ACK 新增 screen_sleeping，主機與網頁可見休眠狀態。USB D|status 可讀狀態，D|sleep／D|wake 只作診斷；running 等活動狀態會使強制閒置失效，不改動計時或馬達。
- app `.tools/build/display-idle30/DisplayProbe.ino.bin`，1,469,360 bytes、SHA256 `c68dd775e6c14752c7e898c6260e88375bb90232f0bebea8cb8933ae2142779c`；刷前舊 app verify matched，只寫 0x20000，write hash 及獨立 verify matched。保存中心 −7° 與計時保留。Node 32/32、Python speech mock 5/5、韌體編譯成功。原生 WSL g++ 不存在，因此 30 分鐘邊界／觸碰／重複 marker 不重置／millis 溢位檢查改為實際韌體編譯器執行的 constexpr static_assert，已通過。
- 此次未改動正在進行的休息計時來做休眠測試；真實 30 分鐘等候與實際手指觸控喚醒仍待現場確認，不得將編譯期時鐘測試當成全部硬體驗收。主機本輪服務 PID 12940；依實際環境重新檢查。
- 後續休息自然完成，確認四種語音 start／pause／resume／completed 均 ready、WebSocket device=1、screenSleeping=false、保存中心 −7°。在 completed 狀態執行一次 D|sleep 診斷，實機回覆 sleeping=true、idle_timeout_seconds=1800；未改動計時或馬達。已請使用者觸碰確認亮屏，觸控觀察待回報；此測試是強制走相同閒置路徑，不是實際等待 30 分鐘。

## WebSocket、多任務馬達與提前語音（2026-10-26，已部署）

- 使用者要求開始轉頭更明顯、多執行緒、WebSocket、台灣用語，並要求語音提前產生。番茄鐘預設改為左右 ±15° 往返；網頁往返測試區新增「套用至番茄鐘」，可保存 5～30°，套用設定不立即移動。原先保存的居中偏移 −7° 保留，所有角度仍相對此中心；pitch 仍停用，未開放 ±50°。
- 裝置新增獨立 FreeRTOS 馬達任務（BodyMotionTask.h），由佇列排程；主迴圈繼續畫面、計時 ACK 與燈效。I2C 電源／燈效以 recursive mutex 協調；馬達執行期間不啟動音訊或相機，語音先播完再排動作。手動與自動對稱往返均有 24 秒供電上限，結束解除扭力／VM off。USB 診斷命令也改由任務排程。
- 主機 `ws`（package-lock 鎖定安裝版本）提供 `/api/live` 網頁即時狀態與 `/api/device/live` 裝置即時 frame／ACK；裝置獨立 WebSocket 任務，HTTP 保留為相機／音訊傳輸與狀態備援。事件每 500 ms 推送，新增音訊可用通知會喚醒 HTTP 下載，不再等原本 2 秒輪詢。裝置 token、Host／Origin 與 public mode 認證檢查沿用；瀏覽器不能以 socket 訊息操作裝置。第一次候選曾因 extraHeaders 末尾多 CRLF 導致握手後斷線，已移除並實機確認連線維持。
- `PreparedTimerVoice` 把台詞與已正規化 PCM 提前放在記憶體（最多四份、序列準備），不落盤。待機準備該階段開始及結束，完成狀態預備下一階段開始；執行中最晚在剩餘 120 秒時準備結束。暫停預備 resume；重設／暫停／切換／設定變更使舊內容失效，過期結果不播放。準備失敗會稍後重試；若使用者在尚未備妥時操作仍可能等待，網頁顯示準備狀態。
- 台詞強制明說「專注」或「休息」並檢查開始／繼續／完成語意；不符時使用對應備援句。prompt 加入台灣口語具體範例，排除中國用語與實測發現的「這波專注／專注的繼續」等生硬句型。TTS 引擎／角色音色未更換。
- 現行韌體 `.tools/build/display-realtime-fixed/DisplayProbe.ino.bin`，1,468,160 bytes、SHA256 `2a8d8ebc9fe9f7ec6e225f140cc45ead3bc7cf665dbec3884bb975626f7c1030`。刷前舊映像 verify matched；只寫 0x20000，write hash 及獨立 verify matched，未寫 NVS／分割表／assets。編譯新增 Arduino WebSockets 2.7.2（安裝於既有 WSL ext4 user libraries），Node 需先 `npm ci`。Node 28/28、Python speech mock 5/5 通過。
- 真實整合：專注暫停狀態的 resume 音訊 preparedAt=1793002667959，比事件 triggeredAt=1793002857708 提前約 190 秒；source=timer-prepared，enqueueDelayMs=1，之後裝置回報 playback→completed。這是「進入播放佇列」延遲，不是喇叭出聲的物理延遲。接著觀察到 motionBusy=true，約 32 秒取樣中 WebSocket 保持 1 條裝置連線，render_count 有 31 次變化、ACK 繼續更新。證明背景任務未凍結畫面／同步；實際 ±15° 幅度、回正精度與新台詞聽感仍需使用者觀察。測試後專注繼續計時，沒有捏造完成事件；結束語音尚未等到真實計時完成驗證。

## 番茄鐘機身燈效與安全動作（2026-10-26，已部署，待首次事件實機驗收）

- 最新：使用者澄清「保存轉圈圈」是網頁載入，不是裝置轉圈；另外回報開始休息後未回到先前居中。實測保存 API HTTP200 約 30 ms、保存偏移 −7°，無新位移任務。網頁新增保存中／已保存／失敗明確提示、motor POST 10 秒 timeout、避免背景輪詢舊狀態覆蓋 mutation 結果；已保存時仍可再次按保存，服務重啟 preview=null 時可保存既有設定，不產生命令。
- 番茄鐘回正原先最後僅等 80 ms 就斷電，與手動微調的到位等待不同。已統一 `settleYaw`：最後回正目標重送四次、每次 250 ms，最後再等 500 ms；自動動作供電預算由 3 秒改為 5 秒，手動往返仍 24 秒，pitch 仍關閉。這是回正偏位的候選修正，物理效果尚待使用者觀察；RX 不可用，不得宣稱實際到位已驗證。
- 現行 app 1,377,440 bytes、SHA256 `aed812e351bf9d2353a0796be6ab073092707ee28b72ed04bdc003d7a763eb70`，只寫 0x20000，write hash／獨立 verify matched；Node 24/24、網頁 JS 語法檢查通過。服務 PID 10072，保存 −7° 保留。此次未再觸發位移，待使用者重整頁面確認保存提示與下次動作回正。
- 使用者指出居中 ±1° 按鈕實機沒反應；查 API 顯示命令 completed、保存偏移 −10°，Wi-Fi 正常。這僅證明命令傳送，不能判為物理微調通過。已部署到位等待候選修正：扭力啟用後重送最終目標四次（300 ms 動作時間，每次等 250 ms），再等待 500 ms 後斷電；增加 center_offset 回報核對，網頁改稱「命令已送」且明示無位置回讀。app 1,377,376 bytes、SHA256 `9a503ad8fed551646f78dba23fad804ffd6bee91952fcc7a926daa0b6173d727`，只寫 0x20000，write／獨立 verify matched。Node 24/24 通過，服務 PID 25152，保存 −10° 保留。到位時間／背隙僅為待驗證假設，根因及實際移動尚未確認，需使用者在此版本重按一次觀察；不得將先前 API 成功當作微調功能已通過。
- 最新網頁功能：使用者澄清要微調「居中」，並保留往返測試。新增「居中微調與馬達測試」面板，每按一次 ±1°，偏移限 ±15°；完成後按保存，寫入主機 SQLite settings.motorCenterOffset，原廠 NVS 只讀。正中心偏移套用到自動番茄鐘與手動往返；還原原廠居中先移到 0°，仍需保存才持久化。手動往返滑桿 ±5°～±30°放在可展開區，番茄鐘幅度仍單側約 6.25°。
- 新 `motor-control.mjs` 以 Wi-Fi header 傳送帶唯一 ID 的指令，裝置只執行一次，回報到已認證 /api/device/audio 的 motor_result。手動任務執行期間阻擋新的語音、相機與 timer 操作，自動 body cue 停用。回報命令完成及 power off，不聲稱 RX 或物理位置已驗證。Node 24/24 測試通過，含 API 偏移保存、角度限制、互斥與回報 ID 驗證。
- app 1,377,120 bytes，SHA256 `6e99ae413e531caacc9fc5d5e66b9140cb6412faae7366018c8137b285b77758`，只寫 0x20000，write hash 與獨立 verify matched；前版 `.tools/build/display-yaw30/DisplayProbe.ino.bin` 已與裝置 verify matched，可回復。Node PID 本輪為 22316，Wi-Fi connected。實機透過新 API 做 +1° 再 −1°，兩次皆收到 completed／power off；最後 preview=0、saved=0，未替使用者決定居中偏移，肉眼校正交由使用者網頁操作。
- ±30° 手動測試曾完整送出：home 460 → 556 → 364 → 460，ok、pitch off、power off；使用者尚未回報該次實際回正／異音。前次 ±15° 已由使用者確認回正且無卡頓，但仍不夠明顯。尚未測 ±50°。
- 最新：使用者確認 6.25° 無卡頓／異音但不明顯，提出 ±50°，再同意先測 ±15°。新增僅 USB 手動 `yaw-sweep-15`：home 460 → 508 → 412 → 460，3 raw／150 ms 漸進目標、每段停 200 ms、12 秒供電上限、pitch torque-off。自動計時 cue 仍維持已驗證的單側 6.25°。app 1,375,792 bytes、SHA256 `fc7c955e5039ec77070fb448588ffe25c500911787ce15f45cf109c0c4815d2a`，舊 6° 映像 verify matched 後只寫 0x20000，新 write hash 及獨立 verify matched。唯一一次 ±15° 手動命令已回報 ok、last_command_raw 460、power off；人工確認實際幅度、回正與異音待回報。未測 ±30°／±50°，RX 仍無回讀。
- 使用者回報約 3° 動作太小並同意擴大。現行自動 cue 已調為 home → +20 raw（約 6.25°）→ home，每次十個漸進目標轉出及十個回正，維持 3 秒供電上限、20 秒自動事件冷卻、pitch torque-off。app 1,375,088 bytes、SHA256 `b6e3d5f4b847e039051b0819f0e37aaaff14ccf5b8955f7654f216eb841481cd`，只寫 0x20000，write hash 及獨立 verify matched；舊映像 `.tools/build/display-timer-effects/DisplayProbe.ino.bin` 已與裝置原內容 verify matched，可供回復。新版 Wi-Fi 恢復後執行唯一一次 `yaw-open-loop-6`，回報 ok、home 460、peak 480、pitch off、power off；實際幅度／順暢度／異音待使用者觀察。RX 回讀仍未修復，command_sent 不等同 motion_verified。
- 使用者確認機身已出現呼吸燈，且馬達周圍一直淨空。已由完成的休息切到下一段專注並開始 25 分鐘；裝置 ACK 確認 running／1499 秒與 cue `8adf0ada`，同期角色語音進入 synthesizing。ACK 只證明提示收到；實際小幅往返與有無異音仍待使用者回報，未重送動作。
- 主機新增 `TimerEffects`：機身燈與安全小幅轉頭可分別在設定頁開關，預設開啟。持續燈效由裝置依計時狀態計算：專注藍色慢呼吸、最後五分鐘橙色、最後 30 秒紅色快呼吸、休息薄荷色、暫停低亮琥珀、完成綠／金、失聯紅色雙閃；錄音／播放狀態優先覆蓋一般計時燈色。
- start／resume、跨過專注剩餘 30 秒、completed 會建立 8-hex 唯一 cue ID。相同 ID 重送不會重複動作，15 秒未能安全執行即取消；主機重啟不補做舊事件。protocol v2 frame 加入 flags、cue ID 與 cue code，ACK 回傳 `effect_id`，主機只接受與該 frame 完全相符的 ACK。
- 自動馬達目前只重用已由使用者人工驗證的 yaw home raw 460 → +10 raw（約 +3.1°）→ home 路徑；pitch 永不啟用，也未使用未驗證的負方向。語音、錄音或相機占用共用資源時不動作，另有 20 秒冷卻、3 秒供電 timeout，結束必定 torque-off／VM off。相機接管共用 I2C 前會先熄燈；相機期間不為裝飾燈搶回匯流排。
- app 1,374,944 bytes，SHA256 `0094b00d8a2dd088ebb1058f1f7f9acc0ba271014d9f89f75d50a530d8368ff9`。刷前從 0x20000 讀回 `.tools/recovery/pre-timer-effects-20261026.ino.bin`，1,373,120 bytes，SHA256 `ca425325e7d7002614604b76049124e43948e6027c7ece7369228819ddea938c`，與前版一致。新 app 只寫 0x20000，write hash 與獨立 `verify-flash` digest matched；未動 NVS、otadata、partition table、assets 或其他槽。
- watchdog reset 後 protocol v2 Wi-Fi ACK 已恢復：`connected:true`、completed／0 秒／teasing、`audioReady:true`、`effectId:"00000000"`。Node 21/21、Python speech mock 5/5 通過。現有休息完成狀態沒有 cue，因此刷機／重啟沒有觸發馬達；完成燈效與首次「開始計時」的小幅 yaw 仍須使用者實機確認。首次動作前再次確認周圍淨空，不得以 API telemetry 取代肉眼及異音觀察。
- Windows 原生 Espressif 編譯器仍因 `Illegal System DLL Relocation` 無法啟動。已把 CoreS3 所需 Arduino core、`esp-x32`、`esp32s3-libs` 與 libraries 複製到 WSL 使用者 ext4 快取 `/home/webster/.cache/atk-stackchan-arduino-s3`（不納入 Git），全量建置由近一小時降至約一分鐘；執行與刷寫仍在 Windows 本機，不依賴 WSL 常駐服務。

## 馬達安全範圍探針（2026-10-25，首次只讀探針停止於無效位置回覆）

- 使用者要求開始安全範圍測試。已核對官方 K151-R 為 G6/G7、1 Mbps 串列回授伺服，yaw ID 1、pitch ID 2；官方警告 pitch 建議保持 5°～85°，極限可能堵轉損壞。未採用 SG90/PWM 測法。
- 未直接呼叫官方 `M5StackChan.begin()`，因該流程會啟用伺服供電，且缺少校準值時可能將預設零點寫入 NVS。新增 `MotorSafety.h` 使用官方底層 PY32 IO expander 與 SCSCL 通訊；開機不初始化、不供電、不改 NVS／伺服 EEPROM。
- 安全命令只有 probe、off、yaw 基準 ±10 raw steps（約 ±3.1°）及回基準；第一階段完全禁止 pitch 動作。每次操作先解除兩軸扭力，動作前把目前 yaw 寫為目標以避免舊目標跳動，逐 raw step 慢移，結束解除扭力並關閉伺服電源，另有 3 秒供電硬性超時。probe 只短暫供電、解除扭力、讀兩軸 raw position 後斷電。
- 初版安全探針 app 1,368,704 bytes、SHA256 `2a0c1b7fc1b2814c39df94fa6d52e37285bebb01371bf133287bc11b738912c9`。首次嘗試發現 Wi-Fi 啟用時舊主迴圈會讀掉 USB 字元後直接略過，因此當時送出的 probe／off 都未被韌體執行。已改成獨立 USB 安全命令緩衝區；修正版 app 1,368,768 bytes、SHA256 `e940e19ab90d6e21c4d16c67edeb708d5ca7b994b5b7ff2d489a3c47786796ed`，仍只寫 0x20000，write hash 與獨立 `verify-flash` digest matched。初版已從裝置讀回 `.tools/recovery/pre-usb-motor-command-fix-20261025.ino.bin`，大小與 SHA256 均符合上述初版值。
- 使用者確認實機淨空後，修正版先以 `M|off` 驗證成功，裝置回覆 `ok:true`、`power:off`。接著只執行一次不含位移的 `M|probe`；裝置回覆 `ok:false`、`reason:invalid_servo_position`、`power:off`。沒有送出任何 yaw／pitch 位移命令，且不重試探針；在確認實機是否曾有異音或非預期動作、並診斷伺服讀值失敗前，不得進入 ±3° 測試。
- 使用者確認該次探針沒有移動、喀聲或持續嗡鳴。為區分角度超界與匯流排失聯，刷入只增加診斷欄位的 app：1,369,280 bytes、SHA256 `268387eadbb9e76975ff5666589d9d40a443a75aea23af497510239e918fbb9c`，只寫 0x20000，write hash 與獨立 verify-flash digest matched。再次先 `off` 成功，再執行一次無位移 probe；結果 yaw/pitch ping 均 `-1`、torque-off ACK 均 `0`、raw position 均 `-1`，最後 `power:off`。這表示兩軸皆無 UART 回覆，不是單軸角度超界。下一步先完整關機再開機以重置獨立伺服電源／匯流排；使用者再次確認淨空後最多重做一次只讀 probe，仍失敗就停止軟體測試並檢查內部伺服供電／線材或用官方 Servo Test 診斷。
- 使用者已依要求長按電源完整關機、等待後重新開機（不是只按 RST）。重啟後 `M|off` 仍成功；最後一次無位移 probe 的 yaw/pitch ping 仍均為 `-1`、torque-off ACK 均為 `0`、raw position 均為 `-1`，回覆 `power:off`。已停止安全範圍測試，未曾送出任何角度目標。後續不得以重試或猜測 ID 方式驅動；先查 VM 伺服電源與內部線材，或在保留現有應用備份後使用官方 Servo Test 判斷硬體。
- 使用者選擇改用原廠 Servo Test。完整原廠備份 `backups/stackchan-factory-20261023-rom.bin` 重新核對為 16,777,216 bytes、SHA256 `15b0661bccd3ca90ad5f653556e85fa83cfd180667adcefa2a9aaf9fc6822ac7`；從 0x20000 抽出的原廠 ota_0 為 5,177,344 bytes、SHA256 `97b176049d75a3e1851ccc738003b62b3b3938c636f7edb2ba287296cf64ab5b`，esptool image-info 驗證為 `stack-chan` 1.4.4、ESP-IDF v5.5.4、image checksum 與 validation hash 有效。目前診斷版已另存 `.tools/recovery/motor-diagnostic-20261025.ino.bin`（1,369,280 bytes、SHA256 `268387eadbb9e76975ff5666589d9d40a443a75aea23af497510239e918fbb9c`）。原廠 ota_0 已只寫回 0x20000–0x50FFFF，write hash 與獨立 verify-flash digest matched；未動 NVS、otadata、assets、分割表或其他槽。刷寫與校驗皆使用 `no-reset`，裝置停在 bootloader，尚未啟動原廠程式或執行 Servo Test。
- 使用者確認淨空後手動啟動原廠韌體，在「環境設定」依官方首次啟動流程執行 Servo Test，回報結果「正常」，啟動時也沒有馬達異音。這證實兩顆伺服、VM 供電、UART 實體鏈路與機構可由原廠 1.4.4 正常驅動；先前自訂探針雙軸 ping／raw 皆失敗應歸因於自訂韌體初始化或匯流排整合，不應判定硬體／接線故障。目前保留原廠韌體，尚未決定是否回復自訂表情／語音應用。
- 使用者要求逐步比對原廠初始化、修正自訂韌體並恢復表情／語音後再做安全測試。已發現並修正一個確定的整合錯誤：相機會 `release()` 共用的 `M5.In_I2C`，舊馬達程式卻快取 IO expander ready 狀態；現在每次馬達安全命令都先停止相機、必要時重建 I2C，再重新探測 PY32。另將順序改成原廠的「VM_EN high、等待、再初始化 UART1」，每次斷電後刪除 UART driver。順序修正版 app 1,369,584 bytes、SHA256 `012375efce29984b27235c2373e7139115ca0aca766c931b9881e60820c49358`，只寫 0x20000 且獨立 verify digest matched；`off` 成功，但無位移 probe 仍為兩軸 ping `-1`、raw `-1`，最後 `power:off`，因此仍禁止送位置命令。
- 進一步加入不開扭力、不寫校準、不送位置的原始 UART／INA226 診斷。現行 app 1,370,768 bytes、SHA256 `f3c5f73ca643fc81b82c43f95b0d3e3b3c1e9b061c91660d039f3b81a16d0413`，只寫 0x20000 且獨立 verify digest matched。`M|raw` 量到 VM 開關前後 bus `4.1588→4.1562 V`、shunt `-0.000050→0.000185 V`，表示負載確實接上；但 yaw/pitch 各等待 100 ms 都是 0 RX byte。故障已縮小到 Arduino 自訂執行環境的 UART 腳位／路由初始化層，而非 SCSCL 封包 parser，也不是原廠已驗證正常的馬達硬體。命令結束 `power:off`。下一步在這個修正版上做一次真正斷電冷啟動後只重跑 raw probe；若仍 0 byte，改以最小原廠 BSP 初始化探針隔離 M5Unified／完整應用衝突，仍不得送位移命令。
- 使用者完成冷啟動後，raw probe 仍為兩軸 0 RX byte；bus `4.1650→4.1588 V`、shunt `-0.000047→0.000188 V`，最後 `power:off`。另建 `firmware/ServoBspProbe`，只含 `M5.begin()`、官方 Touch/PY32/FTServo 初始化次序，不含 Wi-Fi、相機、音訊、動畫或 `Motion.init()`；Core 3.3.10 版 538,224 bytes、SHA256 `14a90eced6e01f57b1b298086d8a0af6ae47446af9857e4d9942f5bd3fb9ab08` 只寫 0x20000 且 verify matched，結果仍是兩軸 ping／位置 `-1`，證明完整應用整合不是根因。
- 以隔離目錄測 Arduino Core 3.2.6 與 3.3.7；兩版映像寫入與 digest 校驗成功，但即使把 `M5.begin()` 延後，最早的純 USB `M|off` 仍無回覆，因此在原廠 5.5.4 bootloader／目前 USB 路徑下不可作為可觀測的馬達對照，也沒有執行 raw probe。沒有覆蓋既有 3.3.10 工具鏈。
- 回到 Core 3.3.10 後，以已在 CoreS3 實機驗證的 ESP-IDF ScsBus設定做一次 A/B：RX buffer 256、TX buffer 0（同步 TX），取代 raw probe 的 FTServo 1024-byte TX queue。完整表情／語音 app 1,370,880 bytes、SHA256 `e293e570c9c6e732921a8cfc75aa2209eb84d92d65f164b8aeec6d4b631de35b` 已只寫 0x20000、獨立 verify matched；`M|off` 成功。同步 raw probe 仍為 yaw/pitch 0 RX byte，INA226 bus `4.1625→4.1588 V`、shunt `-0.000050→0.000185 V`，最後 `power:off`。因此可排除 FTServo queued-TX 差異。
- 官方文件與 Arduino Servo 範例顯示原廠 Servo Test／`goHome()`／`move()`可直接送位置命令；原廠動作正常能證明 VM、TX、伺服與機構能被驅動，但不必然證明 RX 回讀可用。先前「原廠已證明完整 UART 雙向鏈路」的表述應收斂為「至少 TX 驅動鏈路正常」。目前仍未由自訂韌體送出任何位置目標。下一步若要繼續位移，需把測試明確改為已知原廠 home 起點下的開迴路、單軸、低速、約 3° 範圍，重新確認淨空與無異音後才執行；不能再以 `ReadPos` 成功作前提或把 RX=0 當成馬達故障。
- .199 Node 服務當時未監聽，已以既有私有設定在背景重新啟動；裝置 Wi-Fi ACK 恢復，`check-device.mjs completed` 通過，回報 teasing／completed／0 秒／`audioReady:true`。完整 Node 測試 18/18、Python speech mock 5/5 通過；第一次在受限沙箱內因 loopback EACCES/WinError 10013 失敗，允許本機 loopback 後原命令全數通過。未播放、錄音或拍照。
- 使用者再次確認周圍淨空並指示繼續後，加入明確的單次開迴路 yaw 安全命令：只讀既有 NVS `servo/zero_pos_1`，不建立或改寫 key；pitch 全程 torque-off；先把 yaw goal 設為既有 home，再啟用 yaw，逐步低速從 home +1 到 +10 raw（約 3.1°）後逐步回 home，3 秒硬性 timeout，最後解除扭力及切斷 VM。安全測試版 app 1,373,120 bytes、SHA256 `ca425325e7d7002614604b76049124e43948e6027c7ece7369228819ddea938c` 已只寫 0x20000 且獨立 verify matched；前版保留於 `.tools/recovery/pre-open-loop-safety-20261025.ino.bin`，1,370,880 bytes、SHA256 `e293e570c9c6e732921a8cfc75aa2209eb84d92d65f164b8aeec6d4b631de35b`。
- 位移前 `M|off` 成功。唯一一次 `M|yaw|open-loop-3` 完整執行並回報：NVS yaw home raw 460、peak raw 470、pitch torque off、power off、`command_sent:true`、`motion_verified:false`。因 RX 仍不可用，telemetry 只能證明命令序列送出，不能取代使用者觀察；目前等待使用者回報是否有小幅往返、完全未動、喀聲或持續嗡鳴。在取得回報前不得擴大角度、啟用 pitch 或重複測試。
- 使用者實機確認上述唯一一次 yaw 測試「有小幅往返」，因此自訂 3.3.10 韌體的 VM 與 TX 驅動路徑、yaw ID 1、NVS home raw 460 及約 3.1°低速往返已通過人工動作驗證；命令結束仍為 torque-off／`power:off`。這不代表 RX 回讀已修復，也不代表 pitch 或更大角度已驗收。尚待使用者明確回報有無喀聲、持續嗡鳴或其他異音；確認無異音前不得進下一階段。

## Sprite Sheet 表情動畫（2026-10-25，已刷入，待使用者觀感確認）

- 依 4×7 Sprite Sheet 設計重寫裝置端幾何動畫：neutral 眨眼、happy 四格彈跳／落地壓縮、teasing 同步眨眼與偏嘴、concerned 眉眼、TTS 四段嘴型、收音四段波紋，以及新增的正視→看左→回正→看右待機環顧。環顧內建於 neutral，不增加主機協定表情值；語音、收音與其他情緒優先。
- 使用者實機指出 teasing 原本單眼 4–12 px、另一眼 18–24 px 的刻意不對稱看起來像大小眼；已改為所有 teasing 畫格左右眼共用相同寬、高與垂直中心，四格為正常→雙眼半閉→雙眼閉合→正常，角色感只由偏嘴保留。同步更新 Sprite Sheet 並重新刷入；app 1,348,496 bytes、SHA256 `4768e4e0547e47bb457abab51731a639eb005b86981998bd4ec900c957df353b`。刷前備份 `.tools/recovery/pre-eye-symmetry-20261025.ino.bin` 為 1,348,528 bytes、SHA256 `b1e54e3abeee1ab38af28280ea36dee168bd6e03d6cd2bbfb5b4f9171845ad87`，與前一版完全相符。esptool 5.1.0 仍只寫 0x20000，write hash 與獨立 `verify-flash` digest matched；重啟後 Wi-Fi ACK、running／teasing、`audioReady:true`，`check-device.mjs running` 通過。對稱修正版的實際觀感待使用者確認。
- TTS 嘴型不是固定交替，而是從裝置記憶體中正在播放的 PCM 短窗峰值分成閉合／小／中／大四級；音訊不落盤、不新增外傳。仍不初始化馬達。
- 參考 Sprite Sheet 為 `design/expression-sprites.png`，512×448、4 欄×7 列、每格 128×64、透明 PNG；`tools/render-expression-sprites.ps1` 可重現。韌體本身使用 M5Canvas 幾何繪製，不依賴 assets 分割區。
- .199 的 Windows 原生 Espressif 2601 版 64-bit 與 32-bit 編譯器即使重開機、重新下載並核對官方 SHA256，仍在啟動前被 Windows 以 `Illegal System DLL Relocation` 終止。未關閉 Windows 防護；改用同一台 .199 的本機 Ubuntu WSL、固定 M5Stack core 3.3.10／M5Unified 0.2.27／M5GFX 0.2.34 建置。WSL 建置環境位於 `.tools/` 與 WSL 使用者目錄，不走 Git。
- 初版 app binary 1,348,528 bytes、SHA256 `b1e54e3abeee1ab38af28280ea36dee168bd6e03d6cd2bbfb5b4f9171845ad87`。刷寫前以 ROM `--no-stub` 讀回既有動畫版至 `.tools/recovery/pre-sprites-20261025.ino.bin`，1,347,664 bytes、SHA256 `e5f4b20c8db8c8517d6298af6ad6a379bf6fb3880d4da2d89f3aefdf3199250d`，與原交接值完全相符。
- 使用 esptool 5.3.0 **只寫入 0x20000**；write-flash 內建 hash 通過，另行 `verify-flash` 比對 1,348,528 bytes 回報 digest matched，watchdog reset。未寫 bootloader、partition table、otadata、NVS、assets、coredump 或 eFuse。
- .199 重開機後 Node 未自動啟動，本輪以既有私有設定重新啟動；新韌體恢復 Wi-Fi ACK，`check-device.mjs completed` 通過，裝置回報 `teasing`、completed、0 秒、`audioReady:true`。Node 18 項測試在本輪韌體修改前已通過；後續新增只涉及韌體與 Sprite Sheet。
- 目前只能確認建置、Flash、啟動、同步及 audioReady；眨眼、左右看、各表情幅度、PCM 嘴型與收音波紋的實際觀感仍需使用者看裝置確認，不能以 telemetry 代替視覺驗收。

## 整合互動第一版（2026-10-25，已部署 .199 與新版韌體）

- 使用者指出原有功能雖可分別運行，但缺少整合。已新增 `interaction.mjs` 作共同互動狀態：ready／listening／speaking／review／recovering／needs_attention，統一判斷裝置、STT、TTS、音訊測試與相機是否可用；`/api/state` 新增 `interaction` 與 `character`，不含錄音或影像內容。
- 網頁把「說話五秒」與「播放最新 AI 回覆」收進對話卡。STT 完成後只把文字帶入對話框，仍需使用者確認並按傳送；不自動送給 AI。原任意文字 TTS 保留在進階區，不再作為主要互動入口。
- 設定新增兩個明確 opt-in：計時開始／暫停／完成時播放角色台詞，以及 AI 回覆後自動以 R2 播放。使用者已要求並啟用前者；每次事件由本機 Ollama 依事件、專注／休息、今日完成輪數、在席狀態、台北時段及最近四句動態產生 12～45 字台詞，再交給 R2，模型失敗才用內建備援。未提供真實天氣時明確禁止模型假裝知道天氣；天氣來源仍待另行設定。
- 動態計時台詞已真實觸發一次「開始專注」：產生非固定的新台詞，角色表情 teasing，R2 裝置播放 completed，音訊 5.52 秒；.100 health 為 `last_engine=qwen3-local`、`fallback_count=0`。計時在語音生成／合成期間持續，不被阻塞。最近台詞只保留於本程序記憶體，不寫入對話歷史。
- 使用者回報 `resume`（暫停後重新開始）曾產生與恢復計時無關的台詞。已將 start 與 resume 的語意及備援句分離；resume prompt 明定是「同一段暫停後回來繼續」，並要求生成結果至少含回來／繼續／接著／接續／再來／重新之一，否則視為不合格並使用相關備援。新版已部署，既有進行中計時、設定與裝置連線保留；待下一次人工暫停／繼續確認實際聽感。
- 修正持久化狀態若停在 `break + idle` 時只能開始休息、無法回到專注的流程缺口：計時尚未開始時新增「改為專注／改為休息」，切換時依各自設定重設剩餘時間但不啟動計時；進行中、暫停或完成狀態禁止直接切換，避免破壞既有計時。
- .199 Node 服務已重啟載入新版，原資料庫、`.env`、裝置與語音金鑰均保留；實查裝置 Wi-Fi 重新連線。完整 Node 18 項測試通過；本機頁面確認新整合控制元件已載入。此機沒有可用 Python 執行環境，且本輪未改 .100 speech service，因此未重跑 Python mock。
- 為處理 TTS 後 STT 曾需 RST 的問題，韌體來源在每次音訊結束時明確釋放喇叭／麥克風／PSRAM、恢復 I2C 與預設工作狀態，並在既有 sync ACK 增加可選 `audio_ready`。主機相容舊韌體：舊版缺少欄位時為 null，新版明確 false 時暫停新的 TTS／STT 操作。
- 先前只含音訊恢復的未刷候選已被動畫版取代。使用者明確同意後，動畫版 app binary 1,347,664 bytes、SHA256 `e5f4b20c8db8c8517d6298af6ad6a379bf6fb3880d4da2d89f3aefdf3199250d` 已使用 esptool 5.3.0 ROM 模式**只寫入 0x20000**；write hash 與獨立 `verify-flash` digest 均通過，watchdog reset。未動其他分割區或 eFuse。
- 新版 Wi-Fi ACK 自動恢復並回報 `audioReady:true`；進行中 focus timer 與裝置約差 2 秒，`check-device.mjs running` 通過。純螢幕動畫包含待機眨眼、happy 輕跳、teasing 眨眼、concerned 眉眼、TTS 嘴型、提示音及收音聆聽波紋，不初始化馬達。使用者實際確認動畫看得到，但表示不太明顯；目前版本先保留，後續若續作應優先提高位移、嘴型與波紋辨識度。idle／paused stable render、「重新開始」新版台詞聽感與「R2 播放後不重設直接 STT」仍待實測，不能把刷寫／telemetry 成功當成完整修復。

## R2 跨主機、裝置聽感與播放後 STT 回歸（2026-10-25）

- **API：**在 .199 以既有 `tools/check-synthesis.mjs` 呼叫 .100 現有 `/synthesize`，HTTP 與 PCM 格式檢查通過：17000 Hz、16-bit little-endian、mono、3.04 秒、peak 15001，音訊未保存。隨後直接檢查 .100 `/health`：`tts.engine`／`configured_engine`／`last_engine` 均為 `qwen3-local`、voice R2、CUDA、worker ready，`fallback_count=0`；本次不是 Hanhan 回退。此筆端到端等待約 39 秒，仍不宣稱即時。
- **裝置：**.199 Node 服務沿用原私有設定啟動；StackChan Wi-Fi ACK 持續，角色 TTS 播放流程完成，音量 208／加強輸出，計時未在進行中。使用者由網頁手動播放短句及得意／關心台詞；沒有自動播放、重刷韌體或搬移服務。
- **使用者聽感：**使用者確認中文清楚，對角色感與音量表示「很滿意」，按下播放後約 5～10 秒出聲。這是 R2 新聲線的裝置聽感通過；長時間穩定性、弱網路與 Ollama 同時負載仍未驗證。
- **真人 STT 回歸：重設後通過，但留下播放後恢復問題。**依規則先告知使用者，再由使用者手動按「收音五秒並辨識」；角色語音播放後前兩次都顯示「裝置錄音未送達，請重試」。兩次期間 Wi-Fi ACK 持續，但 .199 沒收到裝置的 `tone`、`recording`、完成或 PCM 上傳，工作約 30 秒後 timeout，peak／RMS 均為 0；音訊未送至 .100，不能算 STT 模型失敗。短按裝置 RST、等 Wi-Fi 恢復後由使用者再次手動收音，.199 `speech`／`audio` 均 completed，取得非空辨識結果，.100 health 仍為 CUDA/small；使用者確認文字正確，按下收音後約 5～10 秒產出結果。未記錄逐字稿或保存錄音。仍需追查為何 TTS 播放後需 RST 才能恢復收音。

## .199 TTS 編譯、刷入與基本播放驗收（2026-10-24）

**.100 最新部署：角色 TTS 已接入 8001。** 啟動前 8001 未監聽，已以 `start.ps1 -TtsEngine character` 啟動既有 CUDA/small STT 加 R2 常駐獨立 worker，原私有設定不變。真實合成 API 完整句 29.50 秒／短句15.81 秒、17k raw PCM 驗證通過；合成語音五秒 GPU STT 回歸13.60秒成功，獨立 Hanhan 回退0.45秒成功。角色36秒逾時終止 worker，回退 Hanhan；詳見 `TTS_SETUP.md` 最新章節。推論尚未加速到即時；未動 .199 或韌體，新聲線裝置／真人回歸與 Ollama 同時負載仍待驗收。

角色聲線最新進度：使用者對 R2 固定參考的完整句與兩句新台詞回饋「還不錯」，初步聽感通過，以此為後續整合基準。仍未整合新聲線、未驗收新聲線裝置播放／延遲／STT 共存；舊服務及韌體保持原樣。

.100 最新：以 R2 合成音訊建立 Qwen3-TTS Base 可重用參考，完整句及兩句新台詞已完成真實 GPU 合成，約 7～14 秒音訊／15～29 秒合成。24k 原生與17k 實際重取樣 WAV 六檔檢查通過，待使用者確認聲線及情緒，尚未整合 `/synthesize`。詳見 `VOICE_REFERENCE_SPEC.md`；.199、裝置與既有服務均未更動。

**聲線最新選擇：R2 開頭＋原 A1 後段方向。** 使用者已選 R2；完整一致版與新台詞仍待驗證，未整合 API。詳見 `VOICE_REFERENCE_SPEC.md`，不需重做開頭二選一。

最新 A1 試聽回饋：使用者表示開頭約前五秒語氣怪，後段沒問題；接續只修第一句、保留原 A1，以 A1-R1／A1-R2 比較，詳見聲線文件。尚未進入 API 整合。

.100 原創聲線試聽已完成：Qwen3-TTS VoiceDesign 在獨立環境完成 A1／A2／A3 CUDA 合成，約 15～17 秒音訊各花 32～35 秒（不含載入）。檔案在 `.tools/voice-design/auditions/`，詳細版本、檢查與待測項見 `VOICE_REFERENCE_SPEC.md`。尚待使用者選聲，未改現有 STT／TTS／API、未搬移 .199、未刷裝置，亦未做同時推論或新聲線裝置驗收。

後續使用者同意先以 Qwen3-TTS VoiceDesign 用文字生成原創 A 聲線，在 `.tools/voice-design/` 獨立環境試聽，無需等待真人參考錄音；實際完成狀態以 `VOICE_REFERENCE_SPEC.md` 最新結果為準。選定前不整合現有 `/synthesize`。

聲線方向已由使用者選為 **A 清亮俏皮**，詳見 `VOICE_REFERENCE_SPEC.md`。這是選角方向確認，實際音色仍待取得參考素材並合成試聽後選定。

.100 聲線接手補充：使用者目前無參考素材，要求先整理規格與取得方式，已新增 `VOICE_REFERENCE_SPEC.md`。現場確認 Wi-Fi .100、RTX 5070 12227 MiB、驅動 591.86，8001／11434 有監聽；未重測模型或 API，不代表新增驗收。GPT-SoVITS 優先、IndexTTS 候選，尚無安裝／新合成／使用者選聲。既有服務、設定與裝置未變更；待素材及本機保存授權後試聽，選定才整合。

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
