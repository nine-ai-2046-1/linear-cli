# Section 2 (`sec-02-workspace-teams-users`) QA & Verification Report

- **Target Package**: `@nineai/linear-cli` (`0.1.0`)
- **Working Directory**: `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli`
- **Compiled Binary Audited**: `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli/dist/bin/linear.js`
- **OpenSpec Change**: `sec-02-workspace-teams-users` (`workspace-directory-discovery`)
- **Verification Date**: 2026-11-25
- **Overall Verdict**: **PASS** (All 5 spec requirements in `workspace-directory-discovery` passed live and automated verification; 0 blocking defects, 5 minor non-blocking observations)

---

## 1. Automated Validation, Typecheck, and Test Suite Results

### 1.1 OpenSpec Strict Validation
Command executed:
```sh
openspec validate sec-02-workspace-teams-users --strict --json
```
Observed output (exit code `0`):
```json
{
  "items": [
    {
      "id": "sec-02-workspace-teams-users",
      "type": "change",
      "valid": true,
      "issues": [],
      "durationMs": 10
    }
  ],
  "summary": {
    "totals": {
      "items": 1,
      "passed": 1,
      "failed": 0
    },
    "byType": {
      "change": {
        "items": 1,
        "passed": 1,
        "failed": 0
      }
    }
  },
  "version": "1.0",
  "root": {
    "path": "/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli",
    "source": "nearest"
  }
}
```
- **Result**: **PASS**

### 1.2 TypeScript Typecheck (`npm run typecheck`)
Command executed:
```sh
npm run typecheck
```
Observed output (exit code `0`):
```text
> @nineai/linear-cli@0.1.0 typecheck
> tsc --noEmit
```
- **Result**: **PASS** (`0` compiler errors)

### 1.3 Automated Vitest Suite (`npm test`)
Command executed:
```sh
npm test
```
Observed output (exit code `0`):
```text
 RUN  v5.1.1 /Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli

 Test Files  5 passed (5)
      Tests  15 passed (15)
   Start at  12:59:46
   Duration  201ms (import 59%, tests 23%, transform 16%, worker 3%)
```
Verbose breakdown across all 5 test files (`15/15` passed):
- `tests/sec-02-workspace/resolvers.test.ts` (`2/2` passed):
  - `parses human-friendly priority names and rejects invalid values`
  - `resolves team by key, user by 'me', and rejects ambiguous user names with exit code 6`
- `tests/sec-02-workspace/workspace-cli.test.ts` (`2/2` passed):
  - `executes workspace info, me, user list/get, team list/get/members, status list, label list, and template list/get`
  - `returns AMBIGUOUS_RESOURCE (exit 6) when user get matches multiple users`
- `tests/sec-01-auth/runtime.test.ts` (`6/6` passed)
- `tests/sec-01-auth/auth-cli.test.ts` (`2/2` passed)
- `tests/sec-01-auth/auth-store-and-oauth.test.ts` (`3/3` passed)
- **Result**: **PASS** (`5/5` test files, `15/15` tests)

---

## 2. Live Compiled-Binary Subprocess Verification

All live tests executed `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli/dist/bin/linear.js` inside an isolated temporary folder `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec02-qa-g3Mwem` using `--storage file` and default scopes (`read,write`), performing strictly read-only Linear queries, followed by `auth logout --json` and directory deletion.

### 2.1 Isolated Temp-Folder Authentication
Command:
```sh
node dist/bin/linear.js auth login --app \
  --client-credentials-file ~/.config/linear-agent-mcp/client.json \
  --storage file --json --non-interactive --cwd "$TMP_DIR"
```
- **Exit Code**: `0`
- **Observed `stdout`** (app synthetic actor email redacted):
```json
{
  "ok": true,
  "data": {
    "authenticated": true,
    "folder": "/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec02-qa-g3Mwem",
    "authType": "app",
    "storage": "file",
    "account": {
      "id": "aeed4513-8d63-407a-b35c-9ed566e1749e",
      "name": "Local Agent MCP",
      "displayName": "localagentmcp",
      "email": "<REDACTED_APP_ID>@oauthapp.linear.app",
      "isApp": true
    },
    "workspace": {
      "id": "4b04ee96-418a-4d9e-adb9-0114d4f994eb",
      "name": "NineAI",
      "urlKey": "nineai",
      "url": "https://linear.app/nineai"
    }
  }
}
```
- **Result**: **PASS**

### 2.2 Workspace Inspection (`workspace info`)
1. **JSON mode (`workspace info --json`)** — **Exit Code**: `0`
```json
{
  "ok": true,
  "data": {
    "id": "4b04ee96-418a-4d9e-adb9-0114d4f994eb",
    "name": "NineAI",
    "urlKey": "nineai",
    "url": "https://linear.app/nineai"
  }
}
```
2. **Human mode (`workspace info`)** — **Exit Code**: `0`
```text
ID   : 4b04ee96-418a-4d9e-adb9-0114d4f994eb
Name : NineAI
Slug : nineai
URL  : https://linear.app/nineai
```
- **Result**: **PASS**

### 2.3 Authenticated Viewer (`me`)
1. **JSON mode (`me --json`)** — **Exit Code**: `0`
```json
{
  "ok": true,
  "data": {
    "id": "aeed4513-8d63-407a-b35c-9ed566e1749e",
    "name": "Local Agent MCP",
    "displayName": "localagentmcp",
    "email": "<REDACTED_APP_ID>@oauthapp.linear.app",
    "active": true,
    "admin": false,
    "guest": false,
    "isApp": true
  }
}
```
2. **Human mode (`me`)** — **Exit Code**: `0`
```text
ID           : aeed4513-8d63-407a-b35c-9ed566e1749e
Name         : Local Agent MCP
Display Name : localagentmcp
Email        : <REDACTED_APP_ID>@oauthapp.linear.app
Admin        : false
Guest        : false
Active       : true
App Actor    : true
```
- **Result**: **PASS**

### 2.4 User Listing, Filtering, Pagination, and Ambiguity-Safe Lookup (`user list` & `user get`)
1. **`user list --json`** — **Exit Code**: `0`
   - Returned all 7 workspace users (`count: 7`, `hasNextPage: false`, `endCursor: "e6bf373e-6284-4011-9fd8-a8f92fcf336c"`) with `id`, `name`, `displayName`, `email`, `active`, `admin`, `guest`, and `isApp` fields.
   - Human mode (`user list`, exit `0`) rendered an aligned 5-column table (`ID`, `NAME`, `EMAIL`, `ADMIN`, `ACTIVE`).
2. **Combined query + team filter (`user list --query raymond --team NIN --json`)** — **Exit Code**: `0`
```json
{
  "ok": true,
  "data": [
    {
      "id": "6d2d2449-bf54-4c72-a1ff-ca3598de1155",
      "name": "Raymond同學",
      "displayName": "photovideo2046",
      "email": "photovideo2046@gmail.com",
      "active": true,
      "admin": true,
      "guest": false,
      "isApp": false
    }
  ],
  "pageInfo": {
    "hasNextPage": false,
    "endCursor": "6d2d2449-bf54-4c72-a1ff-ca3598de1155",
    "count": 1
  }
}
```
3. **Relay cursor pagination (`user list --limit 2 --sort created --json` + `--cursor`)** — **Exit Code**: `0`
   - Page 1 returned 2 users (`香港OC同學`, `深圳豆包同學`) with `pageInfo: { hasNextPage: true, endCursor: "e472ab93-8fd5-46ad-ac3d-8efde0eee4fc", count: 2 }`.
   - Page 2 with `--cursor e472ab93-8fd5-46ad-ac3d-8efde0eee4fc` returned the next 2 users (`深圳OC同學`, `Raymond同學`) with `hasNextPage: true`.
4. **Unique user lookup (`user get "Raymond" --json`)** — **Exit Code**: `0`
```json
{
  "ok": true,
  "data": {
    "id": "6d2d2449-bf54-4c72-a1ff-ca3598de1155",
    "name": "Raymond同學",
    "displayName": "photovideo2046",
    "email": "photovideo2046@gmail.com",
    "active": true,
    "admin": true,
    "guest": false,
    "isApp": false,
    "teams": [
      {
        "id": "10b7ddf4-d8d0-40c3-a850-1530d0b3fb00",
        "key": "NIN",
        "name": "NineAI"
      }
    ]
  }
}
```
   - Also verified `user get "photovideo2046@gmail.com" --json` (exit `0`), `user get me --json` (exit `0`), and human mode `user get "Raymond"` (exit `0`).
5. **Ambiguous user lookup (`user get "同學" --json`)** — **Exit Code**: `6` (`AMBIGUOUS_RESOURCE`)
   - Verified via `spawnSync`: `stdout` length = `0` bytes; `stderr` emitted structured JSON error with all 5 matching candidate users:
```json
{
  "ok": false,
  "error": {
    "code": "AMBIGUOUS_RESOURCE",
    "exitCode": 6,
    "message": "User '同學' matched 5 records; specify a UUID or unique key.",
    "details": {
      "query": "同學",
      "candidates": [
        { "id": "c5303781-c852-4026-b91b-5fe96c84abe1", "name": "香港OC同學", "displayName": "hkopencode", "email": "hkopencode@agentmail.to" },
        { "id": "e472ab93-8fd5-46ad-ac3d-8efde0eee4fc", "name": "深圳豆包同學", "displayName": "baobao2046", "email": "baobao2046@agentmail.to" },
        { "id": "a1347cea-63f3-4f85-bad3-a5366e46bb4b", "name": "深圳OC同學", "displayName": "szopencode", "email": "szopencode@agentmail.to" },
        { "id": "6d2d2449-bf54-4c72-a1ff-ca3598de1155", "name": "Raymond同學", "displayName": "photovideo2046", "email": "photovideo2046@gmail.com" },
        { "id": "e6bf373e-6284-4011-9fd8-a8f92fcf336c", "name": "Nine同學", "displayName": "nine.ai.2046.1", "email": "nine.ai.2046.1@gmail.com" }
      ]
    }
  }
}
```
6. **Nonexistent user lookup (`user get "nonexistent-person-xyz" --json`)** — **Exit Code**: `4` (`NOT_FOUND`)
   - Verified via `spawnSync`: `stdout` length = `0` bytes; `stderr`:
```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "exitCode": 4,
    "message": "User 'nonexistent-person-xyz' not found."
  }
}
```
- **Result**: **PASS**

### 2.5 Team Discovery & Membership (`team list`, `team get`, `team members`)
1. **`team list --json`** — **Exit Code**: `0`
```json
{
  "ok": true,
  "data": [
    {
      "id": "10b7ddf4-d8d0-40c3-a850-1530d0b3fb00",
      "key": "NIN",
      "name": "NineAI",
      "description": null,
      "private": false
    }
  ],
  "pageInfo": {
    "hasNextPage": false,
    "endCursor": "10b7ddf4-d8d0-40c3-a850-1530d0b3fb00",
    "count": 1
  }
}
```
2. **`team get NIN --json` & `team get "NineAI" --json`** — **Exit Code**: `0`
```json
{
  "ok": true,
  "data": {
    "id": "10b7ddf4-d8d0-40c3-a850-1530d0b3fb00",
    "key": "NIN",
    "name": "NineAI",
    "description": null,
    "private": false,
    "cyclesEnabled": false,
    "triageEnabled": true
  }
}
```
   - Missing team (`team get "NONEXISTENT" --json`) exited with code `4` (`NOT_FOUND`).
3. **`team members NIN --json` & `team members NIN`** — **Exit Code**: `0`
   - Returned 5 active team members (`香港OC同學`, `深圳豆包同學`, `深圳OC同學`, `Raymond同學`, `Nine同學`) with `pageInfo.count === 5` and rendered cleanly in human table mode.
- **Result**: **PASS**

### 2.6 Workflow Status Discovery (`status list --team NIN`)
1. **JSON mode (`status list --team NIN --json`)** — **Exit Code**: `0`
   - Returned all 8 states ordered by ascending `position` (`0, 0, 1, 2, 3, 4, 5, 1002`):
```json
{
  "ok": true,
  "data": [
    { "id": "e4fb7323-07c4-4cd9-932d-02662272102d", "name": "Triage", "type": "triage", "color": "#FC7840", "position": 0, "description": "Issue needs to be triaged" },
    { "id": "c03fe2ef-6e61-46a3-952c-c0352581c6bb", "name": "Backlog", "type": "backlog", "color": "#bec2c8", "position": 0, "description": null },
    { "id": "60edbd0a-b53b-4141-9c33-9d85a604d4b7", "name": "Todo", "type": "unstarted", "color": "#e2e2e2", "position": 1, "description": null },
    { "id": "cba6b4c7-7f2b-487c-8131-224c18ef7880", "name": "In Progress", "type": "started", "color": "#f2c94c", "position": 2, "description": null },
    { "id": "df5e363b-6db7-4570-a3d9-e95ef47a50ac", "name": "Done", "type": "completed", "color": "#5e6ad2", "position": 3, "description": null },
    { "id": "8ebd0590-9a44-463a-a02a-4e554ee0c9ca", "name": "Canceled", "type": "canceled", "color": "#95a2b3", "position": 4, "description": null },
    { "id": "385d4520-fdf5-4900-b58f-c4f547e9b352", "name": "Duplicate", "type": "duplicate", "color": "#95a2b3", "position": 5, "description": null },
    { "id": "8eca77a9-bb1d-473b-ac5c-9903ed0a3561", "name": "In Review", "type": "started", "color": "#0f783c", "position": 1002, "description": "Pull request is being reviewed" }
  ]
}
```
2. **Human table mode (`status list --team NIN`)** — **Exit Code**: `0` (verified ordered by ascending `position`):
```text
NAME         TYPE       COLOR    ID                                  
-----------  ---------  -------  ------------------------------------
Triage       triage     #FC7840  e4fb7323-07c4-4cd9-932d-02662272102d
Backlog      backlog    #bec2c8  c03fe2ef-6e61-46a3-952c-c0352581c6bb
Todo         unstarted  #e2e2e2  60edbd0a-b53b-4141-9c33-9d85a604d4b7
In Progress  started    #f2c94c  cba6b4c7-7f2b-487c-8131-224c18ef7880
Done         completed  #5e6ad2  df5e363b-6db7-4570-a3d9-e95ef47a50ac
Canceled     canceled   #95a2b3  8ebd0590-9a44-463a-a02a-4e554ee0c9ca
Duplicate    duplicate  #95a2b3  385d4520-fdf5-4900-b58f-c4f547e9b352
In Review    started    #0f783c  8eca77a9-bb1d-473b-ac5c-9903ed0a3561
```
3. **Missing required `--team` (`status list --json`)** — **Exit Code**: `5` (`VALIDATION_ERROR`).
- **Result**: **PASS**

### 2.7 Label Discovery (`label list`)
1. **`label list --team NIN --json`** — **Exit Code**: `0`
```json
{
  "ok": true,
  "data": [
    { "id": "df5ea9ff-842b-4753-b78b-c6f832a32c68", "name": "Improvement", "color": "#4EA7FC", "description": null, "isGroup": false, "retiredAt": null, "archivedAt": null },
    { "id": "d7631b18-a821-4eaa-b043-514c2ce61f1e", "name": "Bug", "color": "#EB5757", "description": null, "isGroup": false, "retiredAt": null, "archivedAt": null },
    { "id": "63a144cf-e248-4275-92ce-8473fd66bc8c", "name": "Feature", "color": "#BB87FC", "description": null, "isGroup": false, "retiredAt": null, "archivedAt": null }
  ],
  "pageInfo": {
    "hasNextPage": false,
    "endCursor": "63a144cf-e248-4275-92ce-8473fd66bc8c",
    "count": 3
  }
}
```
2. **Combined filters (`label list --team NIN --name Bug --include-groups --include-archived --json`)** — **Exit Code**: `0`, returned `Bug` (`count: 1`).
3. **Human table (`label list --team NIN`)** — **Exit Code**: `0`, rendered `NAME`, `COLOR`, `GROUP`, `RETIRED`, `ID`.
- **Result**: **PASS**

### 2.8 Template Discovery (`template list` & `template get`)
1. **`template list --json` & `template list --team NIN --type issue --json`** — **Exit Code**: `0`, returned `{"ok": true, "data": []}` (workspace currently has 0 templates); human mode `template list` exited `0` with `(no results)`.
2. **`template get nonexistent-template --json`** — **Exit Code**: `4` (`NOT_FOUND`).
3. **Populated template rendering & lookup**: Verified in `tests/sec-02-workspace/workspace-cli.test.ts:135-141` (`template list --type issue --json` and `template get "Bug Report" --json` returning `content: "## Steps"` and `templateData`).
- **Result**: **PASS**

### 2.9 Cleanup & Logout Verification
- Executed `auth logout --json` inside `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec02-qa-g3Mwem` -> **Exit Code**: `0` (`loggedOut: true`).
- Verified `auth status --json` -> **Exit Code**: `0` (`authenticated: false`, `credentialPresent: false`, `binding: null`).
- Removed `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec02-qa-g3Mwem` and verified directory absence (`CLEANED_UP_OK`).
- **Result**: **PASS**

---

## 3. Spec Requirement Traceability Matrix

| Spec | Requirement | Verdict | Evidence |
|---|---|---|---|
| `workspace-directory-discovery` | Workspace and Authenticated Viewer Inspection | **PASS** | Live `workspace info` and `me` (JSON & human) returned `ok: true` (exit `0`) with all required fields (`id`, `name`, `urlKey`, `url` and `id`, `name`, `displayName`, `email`, `admin`, `guest`, `active`, `isApp`). |
| `workspace-directory-discovery` | User Directory Listing and Lookup | **PASS** | Live `user list` verified `--query`, `--team`, `--limit`, `--cursor`, `--sort` with `pageInfo`; live `user get` verified `"Raymond"` (exit `0`), `"me"` (exit `0`), email (exit `0`), `"同學"` (`AMBIGUOUS_RESOURCE` exit `6` with 5 candidates), and `"nonexistent-person-xyz"` (`NOT_FOUND` exit `4`). |
| `workspace-directory-discovery` | Team Listing, Details, and Membership Discovery | **PASS** | Live `team list`, `team get NIN`, `team get "NineAI"`, and `team members NIN` succeeded (exit `0`); `team get "NONEXISTENT"` returned `NOT_FOUND` (exit `4`). |
| `workspace-directory-discovery` | Team Workflow Status and Label Discovery | **PASS** | Live `status list --team NIN` (JSON & human) returned 8 workflow states sorted by ascending `position`; live `label list` verified `--team`, `--name`, `--include-groups`, and `--include-archived`. |
| `workspace-directory-discovery` | Template Listing and Details | **PASS** | Live `template list` (`--team`, `--type`) returned exit `0` and `template get nonexistent-template` returned exit `4` (`NOT_FOUND`); `workspace-cli.test.ts` verified populated `template list --type issue` and `template get "Bug Report"`. |

---

## 4. Defects & Observations

### Blocking Defects
- **None** (`0` blocking or spec-violating defects found).

### Minor / Non-Blocking Observations
1. **`user list --team <team>` ignores `--include-disabled`** (`src/modules/workspace/commands.ts:112-129`):
   - Without `--team`, `client.users(...)` receives `includeDisabled: Boolean(opts.includeDisabled)`. When `--team` is passed, `tObj.members(...)` is queried without forwarding `includeDisabled` or filtering disabled members consistently.
2. **In-memory group filtering in `label list` can shrink page size below `--limit`** (`src/modules/workspace/commands.ts:399-427`):
   - `label list` fetches `--limit` records from `client.issueLabels(...)` and then filters `!i.isGroup` in memory unless `--include-groups` is set. Pushing `isGroup: { eq: false }` into the GraphQL `filter` when `!opts.includeGroups` would preserve full page sizes when label groups exist.
3. **`template get <name>` lacks `--team` option for team-only templates** (`src/modules/workspace/commands.ts:454-463, 487-521`):
   - `template list --team <team>` merges `client.templates` with `teamObj.templates()`, whereas `template get <template>` accepts no `--team` flag and searches only `client.templates` when resolving by name (UUID lookup via `client.template(q)` works regardless).
4. **`isApp` heuristic differs slightly between `resolveUser` and `user list`** (`src/core/resolvers.ts:130` vs `src/modules/workspace/commands.ts:127, 144`):
   - `mapUserNode` in `resolvers.ts` computes `Boolean(raw.app) || Boolean(email && email.endsWith("@oauthapp.linear.app"))`, whereas `user list` uses `Boolean(u.app)` directly. In live testing Linear populated `u.app = true` for both `Local Agent MCP` and `Linear`, so live outputs matched, but sharing `mapUserNode` would keep the fallback identical.
5. **Explicit `NOT_FOUND` (`exit 4`) assertion missing in `resolvers.test.ts`** (`tests/sec-02-workspace/resolvers.test.ts:14-97`):
   - `tasks.md` item `1.1` mentions unit test coverage for `NOT_FOUND` (`exit 4`) in `resolvers.test.ts`. While `NOT_FOUND` (`exit 4`) works properly in `src/core/resolvers.ts` (confirmed live across `user get`, `team get`, and `template get`), `resolvers.test.ts` currently asserts exact matches, `VALIDATION_ERROR`, and `AMBIGUOUS_RESOURCE` (`exit 6`) without a dedicated `NOT_FOUND` unit test case.

---

## 5. Re-verification (post-fix)

- **Date:** 2026-11-25
- **Context:** After the original verification, a later section's verifier proved that `label list` always reported `retiredAt: null` for retired labels because the `@linear/sdk` `IssueLabel` fragment omits the field (raw `api query` returned the real timestamp). `label list` was fixed to enrich the current page via a supplementary raw GraphQL query (`issueLabels(filter: { id: { in: $ids } }, first: $first) { nodes { id retiredAt } }` through `client.client.rawRequest`).
- **Note on method:** independent subagent capacity was unavailable (repeated "Free usage limit reached" errors on 4 launch attempts), so this focused re-verification was executed directly by the main agent against the compiled binary. The original independent verification above stands; this section only re-checks the one changed command.

### What was executed (compiled `./dist/bin/linear.js`, fresh temp folder, `--storage file`)

| # | Check | Observed |
|---|---|---|
| 1 | `label list --json` (authenticated) | exit 0, `ok:true`, **3 labels** — Improvement, Bug, Feature (original workspace state) |
| 2 | `label create --name "Sec02 RV Probe" --color …` → `label archive <id>` → `label list --name … --json` | retire succeeded; **`retiredAt = 2026-11-25T09:27:32.733Z`** (non-null ISO timestamp — previously always `null`) |
| 3 | `label list --limit 250 --json` | **exit 0** — enrichment query does not exceed Linear's query-complexity limit |
| 4 | `label list --team NIN --json`, `label list --include-archived --json` | both exit 0 — filters unchanged |
| 5 | Cleanup: `label archive <id> --delete --yes` → `label list --json` | probe deleted; workspace back to exactly **3 labels** (Improvement, Bug, Feature), no leftovers |
| 6 | `auth logout` | exit 0; temp folder deleted |
| 7 | Shared credential file `~/.config/linear-agent-mcp/client.json` | stat **identical before and after**: `1795512864 99`; `auth revoke` never run |
| 8 | `npx vitest run tests/sec-02-workspace` | **2 files / 4 tests passed** (test now mocks `client.rawRequest` and asserts the enriched `retiredAt`) |

### Result

- The D2-class defect (`retiredAt` always null in `label list`) is **fixed and confirmed live**: retired labels now show the authoritative timestamp from Linear, and the human `RETIRED` column derives from it.
- No regressions observed in `label list` filtering, pagination, or the rest of Section 2's commands; unit suite green (whole suite: 13 files / 26 tests).

**VERDICT: PASS**
