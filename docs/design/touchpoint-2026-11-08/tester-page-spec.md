# 資料測試者頁面 `/scan/tester`（2026-11-09，未拍板 candidate）

Kirby 2026-11-09：要做成網頁，直接收資料，避免人工搬運造成遺漏。Contract：`src/lib/contracts/tester.ts`。

## 流程（手機，一個頁面）

1. **輸入測試者代碼**（例如 `P07-K7Q2M9`）→ `POST /api/tester/check`。通過後代碼存在 sessionStorage，關掉分頁就失效。
2. **同意說明**（版本 `tester-consent-v1-draft`）：蒐集什麼、用途（只用於改善量測準確度）、照片 180 天後刪除、數值保留到 Kirby 刪除或本人要求、怎麼要求刪除（Email palmate.tw@gmail.com 並附代號）。兩個勾選：「我同意」（必勾）、「附上處理過的照片」（預設不勾，要本人勾選才上傳）。說明也要寫：伺服器短暫保存 IP 雜湊防濫用、資料可能匯出到專案負責人的電腦且一樣遵守刪除規定。
3. **卷尺實測**（同一位受試者一次填好，之後每張照片沿用，可修改）：
   - 左手或右手；
   - 手長：量測者 A 兩次，必填；量測者 B 兩次，選填；
   - 掌寬（指根下方）：同上；
   - 手掌寬（邊到邊）：選填；
   - 每欄旁邊有一張小圖說明從哪量到哪（沿用 Learn 頁的線稿）。
   - 同一位量測者兩次差超過 3 mm 時提示「請再量一次」，不擋送出。
4. **這張照片的條件**：手機型號（文字，最多 40 字）、桌面、光線、參考物（A4／Letter／卡片）、卡片種類（只有卡片時出現）、「這張是故意拍得不理想的」勾選。
5. **掃描**：使用正式的掃描流程（同一個元件，測試者模式）。頁面會記錄每次失敗的 failure code 和嘗試次數。
6. **結果**：顯示 App 量到的值和卷尺平均值的差（mm），以及「已送出」。測試者也可以按「這次放棄」，只送出失敗紀錄。
7. **下一張**：保留卷尺值和手機型號，回到第 4 步。

## 資料

- 新表 `tester_shots`（migration 0016）：欄位見 contract 的 `testerRecordSchema`，加上 participant、day（台北日期）、photo_pathname（可為 null）。`shot_id` unique，作為冪等鍵。
- 照片：私有 Blob，路徑 `tester/<random>.jpg`；由每日 expire cron 在 180 天後刪除照片，並把 photo_pathname 設為 null。
- 紀錄裡不存：姓名、Email、IP、UA、帳號、掃描 id。不寫 `scans`、不產生數值副本、不送含數值的分析事件。
- 速率限制：沿用 analysis 的 IP 限流（`rate_limits` 表，只存 IP 的雜湊、不存原始 IP，每日 cron 約一天內清除；key 前綴 `tester-check:`／`tester-shot:`）。同意說明要照實寫出這一點。
- 匯出：`scripts/tester-export.ts` 每次執行會刪掉本機副本中超過 180 天的照片；`scripts/tester-delete.ts` 也會刪掉本機匯出資料夾裡該代號的紀錄和照片。

## 取用（給 Claude）

- `scripts/tester-export.ts`：用 `DATABASE_URL` + `BLOB_READ_WRITE_TOKEN` 把全部紀錄匯出到 repo 外的資料夾（預設 `../accuracy-collection-2026-11-08/export/`），包括 `shots.csv`、`records.jsonl`、`photos/<shotId>.jpg`。
- `scripts/tester-delete.ts P07`：刪除該代號的所有紀錄和照片。
- 匯出資料夾不得進 repo（`.gitignore` 已排除 repo 外的路徑；腳本拒絕寫到 repo 內）。

## 開關

- 伺服器環境變數 `TESTER_CODES`（逗號分隔）。未設定時頁面和 API 都回 404。代碼由 Kirby 產生（`npx tsx scripts/tester-codes.ts 20` 會印出 20 組），只告訴本人。
- 頁面 `noindex, nofollow`，不放進 sitemap，robots.txt 擋掉，任何公開頁面都不連到這裡。

## 隱私政策

- 政策 v2.1 新增一小節「受邀測試者」：只對拿到代碼的人適用；同意說明以頁面上的版本為準。文案放在 #242，或另外開一個 PR，在合併前交給 Kirby 審。

## 待 Kirby 決定

1. 照片保留 180 天夠嗎？準確度研究如果要拿新版演算法重跑舊照片，可能需要更長的保存期限。
2. 測試者人數，以及是否會公開招募。公開招募的話，代碼發放方式和同意流程要再加強。
