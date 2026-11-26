# `@nineai/linear-cli`（`linear` 本地指令工具）

English: [`README.md`](README.md)

基於 Linear 官方 TypeScript SDK（`@linear/sdk` `v104.0.0`）開發嘅模組化 Agent 專用 CLI。只需全域安裝一次 `linear`，但登入憑證**嚴格按執行資料夾獨立隔離**（`<cwd>/.linear/auth.json`），絕唔會向上讀取父目錄，亦唔會 fallback 用全域共用帳號。

## 全域安裝

```sh
cd linear-cli
npm install
sh ./scripts/install-global.sh
linear --version
```

## 每個資料夾獨立 Linear 帳號登入

當 Agent 或用家喺 `folder-a` 執行 `linear`，只會讀取 `folder-a/.linear/auth.json`（或 `--cwd <folder>`）。真正嘅 token / API key 預設安全存喺 macOS Keychain（`ai.nineai.linear-cli`），亦可用 `--storage file` 存喺 `0600` 權限嘅 `.linear/credentials.json`（自動建立 `.linear/.gitignore` 防止誤交上 Git）。

```sh
# 1. 用個人 API Key 登入（適合每個 project 綁定獨立個人帳號）
printf '%s\n' "$MY_PERSONAL_LINEAR_KEY" | linear auth login --api-key --api-key-stdin --json --non-interactive

# 2. 個人 OAuth 2.0 PKCE 瀏覽器登入
linear auth login --client-id YOUR_OAUTH_CLIENT_ID

# 3. OAuth App client_credentials 無人值守登入
linear auth login --app --client-credentials-file /path/to/client.json --json --non-interactive

# 查看狀態、驗證身份、換帳號（reauth）、登出或撤銷授權
linear auth status --json
linear auth whoami --json
linear auth reauth --api-key --api-key-stdin
linear auth logout --json
linear auth revoke --json
```

## 支援指令總覽（Sections 1–7）

| 類別 | 支援指令 |
|---|---|
| `auth` | `login`、`status`、`whoami`、`reauth`、`logout`、`revoke` |
| `workspace` / `me` | `workspace info`、`me` |
| `user` | `list`、`get <user\|me>`（支援名稱、email、UUID，撞名會回傳 exit `6` `AMBIGUOUS_RESOURCE`） |
| `team` | `list`、`get <team>`、`members <team>` |
| `status` | `list --team <team>` |
| `template` | `list`、`get <template>` |
| `issue` | `list`（多條件篩選）、`mine`、`search <q>`、`get <id>`、`create`、`update <id>`、`status`、`assign`、`unassign`、`label add/remove`、`priority`、`project set`、`archive`、`restore`、`delete --yes`、`subscribe`、`unsubscribe`、`share`、`unshare`、`children`、`parent set`、`relation list/add/remove` |
| `comment` | `list`、`add`、`reply <commentId>`（自動搵返討論串 root parentId）、`update`、`delete --yes` |
| `document` | `list`、`get`、`create`、`update`、`archive`、`restore` |
| `attachment` | `list`、`get`、`upload`、`link`、`download`（只會向 `uploads.linear.app` 傳送認證 header）、`remove --yes` |
| `project` | `list`、`get`、`issues`、`create`、`update`、`status`、`archive`、`restore`、`delete --yes` |
| `milestone` | `list`、`get`、`create`、`update` |
| `cycle` | `list`、`current`、`issues`（支援 `current`、`next`、`previous`、編號或 UUID） |
| `update` | `list`、`create`、`edit`（Project 進度健康狀態 `onTrack\|atRisk\|offTrack`） |
| `label` | `list`、`create`、`update`、`archive`（安全停用 retire）、`restore` |
| `view` | `list`、`get` |
| `inbox` | `list [--unread]`、`read`、`unread`、`snooze --until <time\|none>`（採用 Linear 分組 Inbox 視圖；`--unread` 由伺服器跨全部分頁過濾） |
| `release` / `release-note` | `release pipeline list`、`release list/get/create/update`、`release-note list/get/create` |
| `review` | `list`、`get`、`link`；而 Linear 公開 GraphQL API 未開放嘅內部 Diff 寫入操作會誠實回傳 exit `9` `UNSUPPORTED_BY_PUBLIC_API` |
| `api` | `query`（AST 強制檢查只准唯讀 query）、`mutation --allow-mutation` |
