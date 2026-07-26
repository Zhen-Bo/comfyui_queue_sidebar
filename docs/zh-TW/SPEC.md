# ComfyUI Queue Sidebar — 軟體規格

- **狀態：** 持續維護文件
- **目標版本：** 1.3.0
- **對象：** 維護者、貢獻者、ComfyUI 擴充開發者
- **相關：** [ARCHITECTURE.md](./ARCHITECTURE.md)
- **English:** [../SPEC.md](../SPEC.md)

---

## 1. 概述

ComfyUI Queue Sidebar 是一個**行程內（in-process）的 ComfyUI 前端擴充**，在 ComfyUI 側邊欄
中還原了帶即時圖片預覽的佇列／歷史面板。它以卡片網格顯示等待中、執行中與已完成的任務；
從 WebSocket 事件即時更新執行中的卡片；並讓使用者在全螢幕檢視器（「view mode」）中開啟任何輸出。

它以靜態 `web/*.js` 形式由 ComfyUI 透過 `WEB_DIRECTORY` 載入——**無建置步驟、無執行期相依**。

### 目標

- 還原一個常駐可見、帶縮圖的佇列／歷史面板。
- 以最小延遲反映執行狀態（佇列 → 執行中 → 完成）。
- 對多階段工作流程（如放大）顯示**正確**的輸出——而非只顯示第一個節點的圖片。
- 提供快速的全螢幕檢視器，用於檢視、複製與重新載入輸出。

### 非目標

- 不是獨立的 web 應用；它存在於 ComfyUI 的頁面與 DOM 之中。
- 無伺服器端／Python 邏輯（`__init__.py` 僅宣告 `WEB_DIRECTORY`）。
- 無資料庫；唯一的持久化是一個有界的 `localStorage` 快取。
- 無 UI 框架或建置流程。

---

## 2. 角色與使用情境

唯一的角色是操作 ComfyUI 網頁介面的**ComfyUI 使用者**。

```mermaid
flowchart LR
    user([ComfyUI User])

    subgraph QS[Queue Sidebar]
        uc1([View queue and history])
        uc2([Inspect live preview])
        uc3([Open output in view mode])
        uc4([Zoom / pan image])
        uc5([Copy image to clipboard])
        uc6([Load workflow from output])
        uc7([Interrupt / delete task])
        uc8([Clear pending / history])
    end

    user --- uc1
    user --- uc2
    user --- uc3
    user --- uc7
    user --- uc8
    uc3 -.-> uc4
    uc3 -.-> uc5
    uc3 -.-> uc6
```

---

## 3. 功能需求

### FR-1 — 佇列與歷史顯示
- 以卡片網格合併顯示 `pending`、`running` 與 `history` 任務（`queue-sidebar.js#render`）。
- 排序：pending → running → history；卡片以 `promptId` 為 key 以利穩定的協調（reconciliation）。
- 空狀態顯示「無任務」佔位。
- 每張卡片顯示狀態標籤（running/pending/completed/failed/cancelled），已知時並顯示執行時間。

### FR-2 — 即時預覽
- 取樣期間，從 `b_preview` WS 事件更新執行中的卡片（latent blob 預覽）。
- 每個 `executed` WS 事件時，將執行中卡片切換為解碼後的 `/view` 輸出，並將所選輸出持久化到快取
  （`outputCache.saveOutputCache`）。
- 已完成／歷史卡片透過 `firstOutput(outputs, promptId)` 解析縮圖——優先取用快取，未命中則
  退回字典逐一走訪（向後相容）。
- **所有卡片預覽一律 contain，不提供切換設定。** 圖片以自身的模糊放大副本填滿格子，完整圖疊在
  上層（`preview.fillContain`），因此格子永遠是滿的、圖片永遠不被裁切。即時預覽與完成後的卡片
  組成方式完全相同——過去執行中卡片硬寫 `object-fit:cover`，導致每次生成結束、完成圖取代最後一
  張串流影格時，畫面都會明顯重新構圖。影片使用單純的 `contain`，不加模糊背景，否則每個可見格子
  都要多跑一個解碼器。

### FR-3 — 任務狀態生命週期
- 狀態轉換遵循 [ARCHITECTURE.md](./ARCHITECTURE.md#5-state-machine--task-lifecycle) 的狀態機。
- 失敗與取消狀態由 `/history` 的 `status_str` 導出。

### FR-4 — View mode（全螢幕檢視器）
點擊已完成的圖片／影片卡片會開啟全螢幕覆蓋層（`gallery.js`）。

- **FR-4.1 基準尺寸** —— 圖片以 `max-width:90vw; max-height:90vh; object-fit:contain` 適配視窗
  （此即「最小尺寸」基準；縮放由此往上放大）。
- **FR-4.2 導覽** —— 上一張／下一張箭頭、`←`/`→` 鍵、計數器；以 `✕`、`Esc` 或點背景關閉。
- **FR-4.3 滾輪縮放**（1.3.0 新增）—— 滾動縮放，步進 `±0.12`，範圍限制 `[1, 4]`，以圖片中心為錨點。
  縮放至 1 時位移歸零。作用範圍是整個覆蓋層（包含四周的深色背景），不只圖片本身；拖曳平移
  （FR-4.4）則仍綁定在圖片元素上。
- **FR-4.4 拖曳平移**（新增）—— 放大時（`scale > 1`），按住即可拖曳平移（pointer capture）；
  於 scale 1 時停用平移。
- **FR-4.5 複製圖片**（新增）—— `Ctrl/⌘+C` 將當前圖片以 `ClipboardItem` 複製到剪貼簿。成功時顯示
  確認 toast，失敗時顯示錯誤 toast；**不**退回複製網址。**僅限圖片**。

  > **不會保留 metadata——這是瀏覽器平台限制，而非 bug。** 非同步 Clipboard API 在寫入時會重新編碼
  > 圖片（Chromium/WebKit 先解碼成點陣圖、再輸出全新的 PNG，以防禦解壓縮炸彈攻擊），因而丟棄 ComfyUI
  > 內嵌的 workflow（`tEXt`/`iTXt` chunk）；標準寫入路徑又只接受 `image/png`，故非 PNG 輸出會被直接
  > 拒絕。唯一能保留位元組的手段（web custom formats，`web image/png`）需要**接收端** app 主動 opt-in，
  > 因此貼上時仍無法還原 workflow。所以 `Ctrl+C` 只是像素層級的「複製圖片」，並非 metadata 傳輸——要
  > 取回 workflow 請用 **Load-workflow 按鈕（FR-4.6）**，或從 `/view` 下載原始檔（原始位元組、chunk
  > 完整；存檔不經過剪貼簿 sanitize）。
- **FR-4.6 載入工作流程按鈕**（新增）—— 紅色 `✕` 左側的半透明灰底按鈕（白色 icon），當輸出帶有 workflow 時，退出 view
  mode 並呼叫 `app.loadGraphData(workflow)`——等同於右鍵的「Load workflow」。無 workflow 時隱藏。
- **FR-4.7 範圍** —— 縮放／平移／複製**僅適用圖片**；影片維持現有行為。
- **FR-4.8 操作提示**（新增）—— 左上角不可互動的長條，列出檢視器控制方式（`←/→`、滾輪縮放、拖曳平移、
  `Ctrl+C`、`Esc`）。
- **FR-4.9 進場／退場動畫**（新增）—— 背景與內容為獨立圖層，採分階段進場（背景先花 140ms 淡入，
  接著內容花 180ms 淡入並從 `.96` 放大）；關閉時兩者共用一個 100ms 的淡出。Load workflow 路徑
  （FR-4.6）則是瞬間關閉、無淡出動畫，因為 `app.loadGraphData` 會阻塞主執行緒，半途中的轉場只會
  卡住後再跳接。

### FR-5 — 右鍵選單
右鍵點擊卡片（`contextMenu.js`）：
- 執行中 → **Interrupt**（`POST /interrupt`）。
- 等待中 → **Delete**（`POST /queue {delete}`）。
- 已完成／失敗／取消 → **Delete**（`POST /history {delete}`），且當 `task.workflow` 存在時顯示
  **Load workflow**（`app.loadGraphData`）。
- 進場為 120ms 的透明度＋縮放動畫，且具方向感——選單會從邊緣翻轉後最終釘住的那個角落長出。關閉
  維持瞬時，現在也會在選單外的 `pointerdown` 時觸發（不只 `click`），因此在別處按住不放（例如
  工具列的清除歷史長按）會立即關閉選單。

### FR-6 — 工具列
- 三顆按鈕依序從左至右：`[clear-pending]` `[interrupt]` `[trash]`，靠右對齊，**清除歷史固定在最後**，永遠貼齊右邊界。整列往左生長收縮，使用者靠位置
  記憶的那顆按鈕永不位移。
- **清除等待中** 單擊只清空等待佇列（`POST /queue {clear}`）（`toolbar.createClearPendingButton`）。
  使用內聯 SVG `list-x` 圖示（衍生自 Lucide Icons，ISC 授權）。它是**出現或消失，不會變灰**，且必須在佇列持續非空達
  `CLEAR_PENDING_REVEAL_DELAY_MS`（500ms）後才出現——送出單一任務時 pending 幾乎立刻轉為 running，沒有這
  段延遲按鈕會閃一下就不見。反向不設延遲：佇列一空就立即開始收起的淡出動畫。但點擊按鈕會跳過該收起
  動畫，瞬間消失以提供即時回饋——與下方中斷執行中相同的主動點擊／被動隱藏之分。
- **中斷執行中** 單擊中斷目前執行中的任務（`POST /interrupt`）（`toolbar.createInterruptButton`）。
  使用 PrimeIcons `pi-stop` 圖示。它是**出現或消失，不會變灰**，在 `running` 非空時立即出現（`INTERRUPT_REVEAL_DELAY_MS` = 0）。當使用者主動點擊時，按鈕無延遲、無動畫立即隱藏，提供即時回饋；當 `running` 被動變為空時（任務自然結束），經 300ms 延遲（`INTERRUPT_HIDE_DELAY_MS` = 300ms）才隱藏，防止連續任務之間閃爍。
- **清除歷史** 單擊只清空歷史（`POST /history {clear}`）；長按 `HOLD_DURATION_MS` 會畫滿一圈進度環，
  完成瞬間同時清空與中斷所有工作（依序發送 `POST /queue {clear}` → 若有執行中任務則 `POST /interrupt` → `POST /history {clear}`）
  （`toolbar.createClearHistoryButton`）。進入長按模式後提早放開則完全不動作。
- **清除歷史永遠不會被 disable 或變灰**，長按也永遠可用；若沒有對應目標，按下去就是不發送請求。
  長按時卡片後退的效果本身就是清除範圍的回饋（包含執行中卡片，亦屬於全部清除範疇）。長按完成瞬間，後退卡片加深隱藏（opacity → 0, scale → .94），直到 render/refresh 清除卡片，防止回彈復甦現象。
  單擊沿用同一套退場，但僅涵蓋歷史卡片——`POST /history` 不會動到 pending 與 running，讓它們一起淡出會謊報這次按壓的破壞範圍。請求與淡出在同一個 tick 發出而非排在
  動畫之後，移除則等兩者中較晚結束者，因此伺服器快速回應也無法在動畫途中把卡片抽走。
- 用顏色建立三階層架構：清除歷史獨佔工具列唯一的常駐紅色警示色（`DANGER`），因為它永久銷毀無法重新產出的歷史結果。中斷執行中靜止時維持清晰的前景文字色（`#eee`），明確標示其為執行中的活躍控制項而不干擾常駐警示色，Hover 時顯示紅色警示色與底色，在點擊前預先傳達危險意圖。清除等待中靜止時維持柔灰色（`#888`），Hover 時提亮，因為它取消的只是可以重新送出的佇列計畫。

### FR-7 — 國際化
- 標籤自 `web/locales/<locale>.json` 載入，locale 讀取自 ComfyUI 的 `Comfy.Locale` 設定；
  英文為退回預設（`comfyAdapter.getComfyLocale`、`queue-sidebar.js#t`）。

### FR-8 — ComfyUI 整合
- 註冊側邊欄 tab + 切換命令／快捷鍵（`Q`）。
- 維護顯示 `running + pending` 數量的圖示 badge。
- **Tab 排序：** 使用 ComfyUI 的預設註冊順序。*（1.3.0 變更——先前的 `sidebarTabs` 陣列 mutation
  已移除，以符合 registry 合規與升級安全。）*
- **佇列刷新：** 由 `status` WS 事件驅動。*（1.3.0 變更——先前的 `queuePrompt` monkey-patch
  已移除。）*

---

## 4. 非功能需求

- **NFR-1 零建置／零相依** —— 以原生 ES modules 發布。
- **NFR-2 優雅降級** —— `comfyAdapter.js` 所擁有的 ComfyUI 內部接觸點（badge、schema、locale）皆有
  功能偵測，失敗時記錄為「降級模式」而非拋錯。少數在別處直接呼叫 `app` 的地方（`queue-sidebar.js`
  的側邊欄註冊；`contextMenu.js`／`gallery.js` 的 `app.loadGraphData`）呼叫的是穩定的公開 ComfyUI
  API，不逐一做防護。
- **NFR-3 Registry 合規** —— 盡量減少觸發 Comfy Registry 安全審查的模式；在有官方 API 或事件可用時
  避免 mutate ComfyUI 內部。
- **NFR-4 可測試性** —— 產生 DOM 的邏輯以 Vitest + jsdom 單元測試；每個 `lib/` 模組都有對應的
  `tests/*.test.js`。
- **NFR-5 效能** —— 渲染採用 keyed reconciliation；執行中卡片的預覽就地更新，不整體重建，只有畫面上
  沒有執行中卡片時才會退回完整 `render()`。卡片的 hover 放大（`preview.js`）是純 CSS 的 `:hover`
  規則，以 `@media (hover:hover) and (pointer:fine)` 限定，並提供 `prefers-reduced-motion` 選擇退出
  ——狀態變更會直接重建卡片元素，CSS `:hover` 對新節點立即重新判定，若改用 JS 驅動的 hover，替換後
  的卡片在靜止的指標下就會卡在未 hover 的狀態。
- **NFR-6 韌性** —— API 失敗顯示 toast 並回傳 `null`（`helpers.safeApi`）；快取寫入在配額錯誤時
  靜默失敗。

---

## 5. 資料契約

### 5.1 ComfyUI REST（透過 `api.fetchApi`）
| 端點 | 方法 | 用途 |
|---|---|---|
| `/queue` | GET | running + pending tuples → `normalizeQueue` |
| `/queue` | POST | `{delete:[id]}` / `{clear:true}` |
| `/history?max_items=N` | GET | history map → `normalizeHistoryItem` |
| `/history` | POST | `{delete:[id]}` / `{clear:true}` |
| `/view?filename&subfolder&type` | GET | 輸出圖片／影片網址 |
| `/interrupt` | POST | 停止執行中的任務 |

### 5.2 WebSocket 事件（`api.addEventListener`）
| 事件 | 內容 | 效果 |
|---|---|---|
| `status` | 佇列計數 | 觸發 `refresh()` |
| `execution_start` | `{prompt_id}` | 立即將 pending→running |
| `b_preview` | 圖片 blob | 更新執行中卡片的 latent 預覽 |
| `executed` | `{prompt_id, output}` | 設定 `/view` 預覽 + `saveOutputCache` |

### 5.3 localStorage
- Key `queueSidebar.lastOutput`：`{ [promptId]: [{ filename, subfolder, type }, ...] }`——單一
  勝出節點（見 `outputCache.taskOutputs`）的全部項目，上限 `OUTPUT_CACHE_MAX = 200`（最舊者淘汰）。
  快取值尚未是陣列時所寫入的舊資料為單一物件；`loadOutputCache` 讀取時會將其包裝成單元素陣列。
- `galleryItems()`（`queue-sidebar.js`）會將每個歷史任務的 `taskOutputs` 攤平進 view-mode 的項目
  清單，因此開啟 lightbox（FR-4）時可以瀏覽每個任務的每一項輸出，而不只是各任務的第一項——這正是
  上述陣列式快取帶來的使用者可見結果。

### 5.4 工作流程擷取
- `workflow = item.prompt[3].extra_pnginfo.workflow`（深層巢狀；有防護——可能為 `null`）。

---

## 6. 驗證

自動化（Vitest）：每個 `lib/` 模組都有單元測試；新的 view-mode 互動新增 `tests/gallery.test.js`。
端對端行為（Playwright）涵蓋載入、卡片排序、即時預覽、輸出快取、view mode、右鍵選單、工具列與
國際化；驗收需要一個運行中的 ComfyUI 實例。

---

## 7. 術語表

| 術語 | 意義 |
|---|---|
| **Task / card（任務／卡片）** | 一個排入佇列的 prompt，以網格卡片顯示，由 `promptId` 識別。 |
| **View mode** | 全螢幕圖片／影片覆蓋層（`gallery.js`）。 |
| **Output cache（輸出快取）** | 每個 prompt 勝出節點之全部輸出項目的 `localStorage` 對應表（陣列）。 |
| **Coupling point（耦合點）** | `comfyAdapter.js`——負責 ComfyUI 的 schema／locale 轉接；少數其他模組（`queue-sidebar.js`、`contextMenu.js`、`gallery.js`）會直接呼叫穩定的 ComfyUI API。 |
| **Degraded mode（降級模式）** | 功能偵測發現 ComfyUI 內部缺失後的狀態；記錄且非致命。 |
| **`firstOutput`** | 決定顯示哪個輸出的解析器，快取優先。 |
