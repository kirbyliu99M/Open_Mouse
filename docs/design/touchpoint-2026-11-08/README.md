# Touchpoint 計畫（2026-11-08 起 15 天，未拍板 candidate）

Kirby 2026-11-08 啟動。本檔是這個計畫的設計與分工總表；進度同步到 `docs/STATUS.md` 和 PRD 排程表（由 Claude 更新）。

## 目標

1. 提升 A4 與卡片的掃描準確度（以卷尺實測值為基準）。
2. 讓網站成為蒐集手型資料的接觸點：測量數值預設保留一份去關聯的副本，可以退出。
3. 依台灣個資法嚴格改寫隱私權政策與所有相關文案。
4. SEO／GEO 補強，並建立論壇（滑鼠討論、量測問題、逐鼠合手回報）。

## Kirby 已拍板（2026-11-08）

- 照片拍的是手背，沒有指紋問題。
- 錯誤照片：自願上傳，保存約 6 個月（180 天），提供刪除碼。卡片模式的照片可以上傳，但要先在裝置上把卡片塗黑。
- 資料用途：只自己用（改善量測、推薦與研究）；對外只發布統計。
- 數值副本：預設保留，可以退出；完全不存連回帳號或掃描的欄位，日期只到月份，數值取整到 1 mm。
- 掃描流程不區分年齡；隱私權政策由團隊自己寫，沒有律師審閱。
- AGENTS.md 硬規則 5 改為「照片預設不離開裝置，唯一例外是自願上傳的錯誤照片」。
- migration 0015 和正式站私有 Blob：先開發；合併前由 Kirby 執行 db:migrate 並設定 Blob。

## 審查後由 Claude 加上的設計（candidate，待 Kirby 確認）

- 使用者主動刪除掃描或帳號時，同時刪除數值相符的副本，每個掃描最多刪一筆。24 小時過期清除和 90 天清除不刪副本。
  - 理由：原始掃描還在的期間，副本可以用數值比對回去，依施行細則第 3 條仍算個資。
- 錯誤照片附帶的數值，在裝置上先取整到 1 mm 再上傳。

## 分工

| 線 | 誰 | 分支 | 內容 | 狀態 |
|---|---|---|---|---|
| Contract＋schema | Claude | `touchpoint-2026-11-08` | hand-sample.ts、error-photo.ts、sampleNotice、migration 0015、硬規則 5 | 已推送 |
| B1 數值副本 | builder | `touchpoint-b1-samples` | 寫入副本、刪除相符副本、確認畫面開關 | 進行中 |
| B2 錯誤照片 | builder | `touchpoint-b2-photos` | 上傳／刪除路由、180 天清除、裝置端裁切塗黑、同意畫面、刪除碼表單 | 進行中 |
| 隱私文案 | Claude 起草，builder 套用 | 待開 | 政策 v2.1（`privacy-policy-v2-draft.md`）＋全站相關句子＋測試 | 草稿待 Kirby |
| SEO P0 | builder | 待開 | 見下方 | 排隊 |
| 論壇 MVP | builder | 待開 | 見 `forum-spec.md` | 規格待 Kirby |
| 準確度 | Claude | 本機 | `scripts/accuracy-eval.ts`，資料在 repo 外 | 等資料 |

### 規則

- 最多 5 個代理同時執行，builder 最多 2 個。
- 每個 PR 都要跑 `pr-review`。合併和正式部署都要 Kirby 同意。
- Playwright 和 `next build` 一次只跑一個，由 Claude 執行。

## 上線順序（不可顛倒）

1. Kirby 在正式站執行 migration 0015。新表沒有外鍵，舊程式碼不受影響。
2. Kirby 建立正式站私有 Blob store，設定 `BLOB_READ_WRITE_TOKEN`。
3. 確認隱私政策中標「待 Kirby」的事實，並核可政策與 UI 文案。
4. 一次部署：副本寫入、照片路由（設定 `NEXT_PUBLIC_ERROR_PHOTO_ENABLED=1`）、清除 cron、新政策與全站文案。政策不能比程式先上線，程式也不能比政策先上線。
5. 部署後在正式站實測：真實瀏覽器、重新整理頁面、刪除碼、帳號刪除。

## SEO P0（builder 簡報草稿）

- 首頁新增 intro 段落，放在 hero 下方，文案為 candidate：
  - zh：「Palmate 用手機拍一張手背照片，以 A4 紙或一張卡片當尺規，量出手長與手寬，再和數百款滑鼠的實際尺寸比對，依你的握法排出可能合手的滑鼠。照片預設只在你的手機上分析。」
  - 連結：「怎麼量手長」到對應指南；「瀏覽所有滑鼠」到 /mice。
  - 「Find Your Best Mouse」是 Kirby 自己的用字，保留不改。
- /mice 的伺服器端 HTML 要列出全部型號的純連結，依品牌分組，用 `<details>` 或放在頁尾，不影響現有的「顯示更多」。
- sitemap：比較頁只留每支滑鼠前 3 個可索引的組合（抽成常數 `INDEXABLE_PAIRS_PER_MOUSE`），/mice/[slug] 頁上的相似連結只連到可索引的組合。
- 每支滑鼠顯示「規格資料更新日」，取自 specRetrievedAt。
- 不做：FAQ 或 HowTo 標記擴充、llms.txt 擴充、Product 評分。

### Kirby 的待辦（不改程式）

- Search Console 確認收錄狀況，對首頁、指南、熱門滑鼠頁要求建立索引。
- Bing Webmaster 匯入 GSC 設定。
