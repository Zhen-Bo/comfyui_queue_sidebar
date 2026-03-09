<p align="center">
  <img src="assets/preview.png" width="100%" />
</p>

<h1 align="center">ComfyUI Queue Sidebar</h1>

<p align="center">
  <b>把舊版帶有圖片預覽的 Queue Panel 帶回來。</b>
</p>

<p align="center">
  <a href="README.md">English</a> | 繁體中文
</p>

<p align="center">
  <a href="#安裝">安裝</a> ·
  <a href="#功能">功能</a> ·
  <a href="#動機">為什麼？</a> ·
</p>

---

## 動機

ComfyUI 新版前端（v1.33.1+）移除了側邊欄中帶有圖片預覽的 Queue Panel，改為頂部的極簡佇列列表。這個改動讓許多使用者失去了一目了然瀏覽生成結果的方式。

**comfyui_queue_sidebar** 透過自訂節點的方式，將舊版的佇列面板原封不動地帶回側邊欄，且不需要修改任何前端檔案。

---

## 功能

| 功能            | 說明                                             |
| --------------- | ------------------------------------------------ |
| 🖼️ **圖片網格** | 自適應網格顯示執行中 / 等待中 / 已完成的任務縮圖 |
| 🎬 **影片支援** | 滑鼠懸停自動播放影片輸出（webm、mp4）            |
| 🔄 **即時預覽** | 生成過程中顯示即時進度預覽（K-Sampler 等）       |
| 📐 **彈性調整** | 隨著側邊欄寬度變化，網格自動從單列調整為多列     |
| 🏷️ **狀態標籤** | 彩色標籤搭配旋轉動畫顯示執行中的任務             |
| 🖱️ **右鍵選單** | 右鍵刪除任務或載入其工作流程                     |
| 🔢 **等待徽章** | 側邊欄圖示上顯示等待中的任務數量                 |
| 🧹 **一鍵清除** | 一鍵清除所有佇列與歷史記錄                       |
| ⚡ **免改前端** | 自訂節點插件——不修改任何前端原始檔案             |

---

## 安裝

### 透過 ComfyUI Manager（推薦）

在 [ComfyUI Manager](https://github.com/ltdrdata/ComfyUI-Manager) 中搜尋 **`comfyui_queue_sidebar`** 並點擊安裝。

### 手動安裝

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Zhen-Bo/comfyui_queue_sidebar.git
```

重新啟動 ComfyUI。**Queue** 標籤會出現在側邊欄（位於「資產」和「節點」之間）。

---

## 解除安裝

從 `custom_nodes/` 中刪除 `comfyui_queue_sidebar` 資料夾即可。

---

## 相容性

- **ComfyUI 前端** v1.33.1+（已測試至 1.39.19）· **ComfyUI 核心** 已測試至 0.16.4
- 與內建的底部面板佇列並行運作，不會衝突
- 插件使用公開的擴充 API 進行註冊和事件監聽。此外會掛鉤少量內部 API（如 `app.queuePrompt`、側邊欄分頁排序）以提供無縫體驗——所有此類整合點均集中於 [`comfyAdapter.js`](web/lib/comfyAdapter.js)，搭配功能偵測與優雅降級機制

---

## 授權

[MIT](LICENSE)
