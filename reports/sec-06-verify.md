# Section 6 Verification: Labels, Views, and Inbox

- **Date:** 2026-11-25
- **Project:** `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli`
- **Binary under test:** `./dist/bin/linear.js` (`--version` → `0.1.0`; `dist/` built 2026-11-25 14:17, newer than `src/` 13:30 — no rebuild performed by this verifier)
- **Workspace under test:** NineAI (`urlKey nineai`), team key `NIN`
- **Auth under test:** shared app credentials `~/.config/linear-agent-mcp/client.json` with `--storage file` in fresh temp folders
- **Temp folders used (all deleted at end):** `…/T/sec06-verify.lXeKnc`, `…/T/sec06-verify2.GlS8ZA`, `…/T/sec06-verify3.ARRSaH`
- **Shared credential file stat (before AND after, identical):** `1795512864 99 /Users/IMTCRS/.config/linear-agent-mcp/client.json` — **unchanged**

## 1. Artifacts read

- `openspec/changes/sec-06-labels-views-inbox/proposal.md`, `design.md`, `tasks.md`, `specs/labels-views-inbox/spec.md`
- `src/modules/metadata/commands.ts` (447 lines: label create/update/archive/restore, view list/get, inbox list/read/unread/snooze)
- `src/modules/workspace/commands.ts` (label `list`, lines 364–445), `src/core/errors.ts`, `src/core/resolvers.ts`, `src/core/output.ts`, `src/core/pagination.ts`, `src/cli/app.ts`
- `tests/sec-06-metadata/metadata-cli.test.ts` (1 test, fully mocked Linear client)

Claims under test: label create/update/archive(retire)/restore; `view list|get`; `inbox list|read|unread|snooze`; `--dry-run` previews; deterministic exit codes; structured `--json`; no secret leakage.

## 2. Unit tests

Command (project root):

```
npx vitest run tests/sec-06-metadata
```

Result (exit 0):

```
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  14:31:57
   Duration  180ms
```

Note: the single test mocks `customViews`, `issueLabels`, `notifications`, etc., so it cannot detect the server-side query-complexity defect in D1 below.

## 3. End-to-end runs (real CLI, fresh temp folders)

### 3.1 Setup

```
TMP=$(mktemp -d …/sec06-verify.XXXXXX)
./dist/bin/linear.js --cwd "$TMP" auth login --app \
  --client-credentials-file "$HOME/.config/linear-agent-mcp/client.json" \
  --storage file --json --non-interactive
```

→ exit `0`; `authenticated: true`, account `Local Agent MCP (app)`, workspace `NineAI (https://linear.app/nineai)`.

### 3.2 Read-only commands

| # | Command (after `--cwd $TMP`) | Exit | Observed |
|---|---|---|---|
| 1 | `label list --json` | 0 | `ok:true`, 3 labels (Improvement, Bug, Feature) with `id/name/color/description/isGroup/retiredAt/archivedAt`, `pageInfo.count=3` — valid structured JSON on stdout |
| 2 | `view list --json` | 0 | `ok:true`, `data: []` (workspace has no saved Custom Views) |
| 3 | `inbox list --json` | 0 | `ok:true`, 3 notifications (`id/type/category/read/readAt/snoozedUntilAt/createdAt/url`) |
| 4 | `inbox list --unread --json` | 0 | 3 unread items returned |
| 5 | `view list --team NIN --shared --query bug --json` | 0 | `data: []` (filters accepted) |
| 6 | `view list --limit 50 --json` | 0 | `data: []` |
| 7 | `view list --limit 100 --json` | **5** | `Query too complex … Complexity: 11650.00000000007. Maximum allowed complexity: 10000.` |

### 3.3 Unknown references and error codes

| # | Command | Exit | Observed |
|---|---|---|---|
| 8 | `label restore "No Such Label Sec06" --team NIN --json` | **4** | `{"ok":false,"error":{"code":"NOT_FOUND","exitCode":4,"message":"Label 'No Such Label Sec06' not found."}}` (stderr), stdout empty, no mutation |
| 9 | `label update "Sec06 Verify Lifecycle" --team NIN --color "#223344" --json` (label does not exist) | **4** | `NOT_FOUND` |
| 10 | `label archive "Sec06 Verify Lifecycle" --team NIN --json` | **4** | `NOT_FOUND` |
| 11 | `view get "00000000-0000-4000-8000-000000000099" --json` (UUID path) | **4** | `NOT_FOUND: Custom view '…' not found.` |
| 12 | `view get "Active Bugs" --json` (name path — the spec scenario) | **5** | `VALIDATION_ERROR: Query too complex … Complexity: 11650.00000000007. Maximum allowed complexity: 10000.` — **not** `4 NOT_FOUND`, and the command can never succeed (see D1) |
| 13 | `view get nope --json` | **5** | same `Query too complex` error |
| 14 | `label update "Sec06 No Flags" --team NIN --json` (no change flags) | **5** | `VALIDATION_ERROR: Specify '--name', '--color', or '--description'…` (raised before any session/network) |
| 15 | `inbox snooze <id> --until not-a-time --json` | **5** | `VALIDATION_ERROR: Invalid --until 'not-a-time'…` (raised before any session/network) |
| 16 | `inbox list --limit 0 --json` | **5** | `VALIDATION_ERROR: Invalid --limit '0': expected an integer between 1 and 250.` |
| 17 | `label archive "Sec06 Verify WsLabel" --delete --json` (no `--yes`) | **5** | `VALIDATION_ERROR: Destructive operation (permanently delete label '…') requires explicit '--yes' flag (or '--dry-run' to preview).` — no mutation |
| 18 | `--expect-workspace wrong-ws label list --json` | **3** | `FORBIDDEN` (workspace guardrail, stderr JSON) |
| 19 | `auth login --api-key --api-key-file <fake> --storage file --json --non-interactive` (2nd temp folder) | **2** | `AUTH_REQUIRED: Invalid Linear API key or unable to verify identity.` |
| 20 | `label list --json` in unauthenticated temp folder | **2** | `AUTH_REQUIRED: No Linear authentication found in folder '…'` |
| 21 | `label create --name "Sec06 Verify Lifecycle" --team NIN --color "#112233" … --json` | **1** | `INTERNAL_ERROR: Not allowed to take action - You are not allowed to create labels in this team.` — a permission denial (see D3) |
| 22 | `inbox read 00000000-…-099 --json` (nonexistent notification) | **5** | `VALIDATION_ERROR: Entity not found: Notification - Could not find referenced Notification.` — **not** `4 NOT_FOUND` (see D4); same for `inbox snooze <bogus> --until +1h` |
| 23 | `view get --help` | 0 | help printed |

### 3.4 `--dry-run` (no mutation verified)

```
./dist/bin/linear.js --cwd "$TMP" label create --name "Sec06 Verify DryRun" \
  --team NIN --color "#EB5757" --description "dry-run probe" --dry-run --json
```

→ exit `0`:

```json
{"ok":true,"dryRun":true,"operation":"label.create",
 "data":{"dryRun":true,"operation":"label.create",
         "parameters":{"name":"Sec06 Verify DryRun","teamId":"10b7ddf4-d8d0-40c3-a850-1530d0b3fb00",
                       "color":"#EB5757","description":"dry-run probe"}}}
```

Input preview includes the resolved `teamId`. Immediately afterwards `label list --name "Sec06 Verify DryRun" --json` → exit `0`, `data: []` → **confirmed no label was created**.

`inbox read <id> --dry-run --json` → exit `0`, preview `{id, readAt: <now>}`; subsequent `inbox list` showed the notification still `read:false, readAt:null` → **confirmed no mutation**.

### 3.5 Write paths exercised (with cleanup)

Label lifecycle (workspace-scoped, because team-scoped creation is blocked — see D3):

| Command | Exit | Observed |
|---|---|---|
| `label create --name "Sec06 Verify WsLabel" --color "#556677" --description "…" --json` | 0 | created `id 63aacf62-3984-4fce-b50f-2604ddf06768`, visible via `label list --name` |
| `label update "Sec06 Verify WsLabel" --color "#667788" --json` | 0 | color updated |
| `label archive "Sec06 Verify WsLabel" --json` | 0 | `{retired:true}` |
| `label list --name "Sec06 Verify WsLabel" --include-archived --json` | 0 | item present but `retiredAt: null`, `archivedAt: null` → see D2 |
| `label restore "Sec06 Verify WsLabel" --json` | 0 | `{restored:true}` |
| `label archive "Sec06 Verify WsLabel" --json` (again) then `api query --query 'query { issueLabel(id:"63aacf62-…") { id name retiredAt archivedAt } }' --json` | 0 / 0 | raw API shows `retiredAt: "2026-11-25T06:37:58.980Z"` → the retire mutation **did** apply; only `label list` fails to display it |
| **Cleanup:** `label archive "Sec06 Verify WsLabel" --delete --yes --json` | 0 | `{deleted:true}`; `label list --name "Sec06 Verify WsLabel" --include-archived --json` → `data: []` (label gone, no leftover) |

Inbox round trip on notification `69d99567-f288-4fa1-9942-f05059ff3efb` (was `read:false, readAt:null, snoozedUntilAt:null`):

| Command | Exit | Observed | State after |
|---|---|---|---|
| `inbox read <id> --json` | 0 | `{read:true, success:true}` | `read:true, readAt:"2026-11-25T06:39:46.525Z"` |
| `inbox unread <id> --json` | 0 | `{read:false, success:true}` | `read:false, readAt:null` — **original state restored** |
| `inbox snooze <id> --until +1h --json` | 0 | `{snoozedUntilAt:"2026-11-25T07:40:02.743Z", success:true}` | snoozed value set |
| `inbox snooze <id> --until none --json` | 0 | `{snoozedUntilAt:null, success:true}` | `snoozedUntilAt:null` — **original state restored** |

### 3.6 Exit codes observed vs. documented set

Observed: `0, 1, 2, 3, 4, 5`. Not exercised this session: `6, 7, 8, 9, 10`.

- README line 70 documents the full set `0` success, `1` internal, `2 AUTH_REQUIRED`, `3 FORBIDDEN`, `4 NOT_FOUND`, `5 VALIDATION_ERROR`, `6 AMBIGUOUS_RESOURCE`, `7 RATE_LIMITED`, `8 OUTCOME_UNKNOWN`, `9 UNSUPPORTED_BY_PUBLIC_API`, `10 NETWORK_ERROR` — every observed code is inside that documented set, and every `--json` error payload's `error.exitCode` matched the process exit status.
- Note: the verification brief listed the documented set as `(0,2,3,4,5,6,7,8,9,10)` (no `1`), but `README.md` and `src/core/errors.ts` both document `1` (`INTERNAL_ERROR`). Exit `1` was observed (item 21) — see D3 for why a permission denial lands there.

### 3.7 Secrets / credential file

- `grep -E "lin_api_[A-Za-z0-9_-]{8,}|lin_oauth_|client_secret…|Bearer …|access_token"` across every captured stdout/stderr file → **NO_SECRET_MATCHES**.
- `~/.config/linear-agent-mcp/client.json` stat before: `1795512864 99`; after all runs (including logins/logouts): `1795512864 99` — **byte-for-byte unchanged (mtime + size)**.
- `auth revoke` was **never** run.

### 3.8 Teardown

```
./dist/bin/linear.js --cwd "$TMP" auth logout --json     # exit 0, loggedOut:true (run in sec06-verify.lXeKnc and sec06-verify3.ARRSaH)
rm -rf <all three temp folders>                          # confirmed gone
```

- Workspace leftovers: none. The only label ever created (`Sec06 Verify WsLabel`) was permanently deleted; the two dry-run/failed creates never materialized; the one inbox notification touched was restored to its original `read:false / readAt:null / snoozedUntilAt:null` state.

## 4. Defects found

### D1 — HIGH — `view get <name|slug>` can never succeed (breaks a spec scenario)

- `src/modules/metadata/commands.ts:66` (`resolveCustomViewNode`, non-UUID path) calls `client.customViews({ first: 100 })`. That query's complexity (11650) exceeds Linear's hard limit (10000), so **every** name/slug lookup exits `5 VALIDATION_ERROR: Query too complex …` before any matching happens.
- Evidence: `view get "Active Bugs" --json` → exit 5 (spec scenario in `specs/labels-views-inbox/spec.md`); `view get nope` → exit 5 (so an unknown name never reaches `4 NOT_FOUND`); `view list --limit 100` fails identically while `view list --limit 50` (default) succeeds — isolating `first: 100` as the trigger. Complexity is computed from the query AST, so this is deterministic for all workspaces, not a transient error.
- The UUID path is unaffected: `view get 00000000-…-099` → exit `4 NOT_FOUND` as expected.
- Consequence: the "by UUID, slugId, or exact name" requirement and the `view get "Active Bugs"` scenario cannot pass; unknown-view reference by name yields exit 5 instead of the required exit 4.
- The unit test cannot catch this because `customViews` is mocked.

### D2 — MEDIUM — `label list` never shows a label as retired

- After `label archive …` returned `retired:true`, `label list --include-archived --json` showed `retiredAt: null, archivedAt: null` (the `RETIRED` column would render `false`). A raw `api query` against the same label returned `retiredAt: "2026-11-25T06:37:58.980Z"`, proving the retire applied and the list output is wrong.
- Root cause: the `@linear/sdk` `IssueLabel` fragment (node_modules/@linear/sdk/dist/index.mjs, `fragment IssueLabel on IssueLabel`) does **not** request `retiredAt`, so the mapping in `src/modules/workspace/commands.ts:415-425` (and `resolveIssueLabel` in `src/core/resolvers.ts:293-310`) always reads `undefined → null`.
- Impact: misleading output; a user/agent cannot tell from `label list` that a label is retired. (Non-blocking for `label restore`, which resolves by name with `includeArchived`.)

### D3 — MEDIUM/LOW — permission denial surfaces as exit `1 INTERNAL_ERROR` instead of `3 FORBIDDEN`

- `label create --name "…" --team NIN … --json` → exit `1`, `INTERNAL_ERROR: Not allowed to take action - You are not allowed to create labels in this team.`
- Two aspects: (a) **environment** — the shared app credential is not permitted to create team-scoped labels (workspace-scoped `label create` succeeded), so the spec's team-label create/archive/restore scenario could not be exercised against NIN; (b) **mapping** — per `openspec/changes/sec-01-foundation-and-auth/design.md`, "Permission denied" should map to `FORBIDDEN` (3), but `normalizeError` in `src/core/errors.ts` only matches 403 / "forbidden" / "not authorized", so Linear's "Not allowed to take action" wording falls through to exit 1. Root cause is in the shared sec-01 error layer, not sec-06 code.

### D4 — LOW — unknown inbox notification id → exit `5` instead of `4`

- `inbox read 00000000-…-099 --json` and `inbox snooze 00000000-…-099 --until +1h --json` → exit `5 VALIDATION_ERROR: Entity not found: Notification - Could not find referenced Notification.`
- Cause: unlike label/view commands, inbox write commands do not pre-resolve the id (`src/modules/metadata/commands.ts:382-446`), and `normalizeError` classifies Linear's "Entity not found" payload as `InvalidInputLinearError → VALIDATION_ERROR` before the not-found checks. `label`/`view` unknown references do return 4 (when reachable). The sec-06 spec does not state an inbox unknown-id code, so this is a consistency issue rather than a hard spec violation.

### D5 — LOW — `view list --limit` accepts values that the server rejects

- `--limit` is validated as `1..250`, but any value ≥ ~86 fails with the same `Query too complex` error (observed at 100). Same root cause as D1.

### D6 — LOW (code observation) — `inbox list --unread` filters client-side on the current page

- `src/modules/metadata/commands.ts:364` applies `items.filter(!read)` after fetching one page (default 50), and `pageInfo.count` is rewritten to the filtered length. With more notifications than one page, unread items beyond page 1 are silently omitted. Not reproducible in this workspace (only 3 notifications).

## 5. Summary table

| Verification item | Result |
|---|---|
| Unit tests `npx vitest run tests/sec-06-metadata` | 1 file / 1 test **passed**, exit 0 |
| `label list --json` structured JSON, exit 0 | **PASS** |
| `view list --json`, `inbox list --json`, `inbox list --unread --json` | **PASS** (exit 0, structured JSON) |
| Unknown label reference → exit 4 `NOT_FOUND` | **PASS** (restore/update/archive all → 4) |
| Unknown view reference → exit 4 `NOT_FOUND` | **PARTIAL** — UUID path → 4; name/slug path → 5 `Query too complex` (D1) |
| `view get <name>` works per spec | **FAIL** (D1 — always exit 5) |
| `--dry-run` on label create: no mutation + input preview | **PASS** (preview with resolved `teamId`; label absent afterwards) |
| Write paths: label create/update/archive/restore, inbox read/unread/snooze | **PASS** (workspace label full lifecycle; inbox round trip restored to original state) |
| Exit codes within documented set (README 0–10), JSON `error.exitCode` matches process exit | **PASS** for observed {0,1,2,3,4,5}; 6–10 not exercised |
| No secrets/tokens in any output | **PASS** (grep over all captured outputs: no matches) |
| `~/.config/linear-agent-mcp/client.json` unchanged | **PASS** (`1795512864 99` before and after; `auth revoke` never run) |
| Teardown: `auth logout` + temp folders removed, no workspace leftovers | **PASS** |

**Overall:** Labels (create/update/archive-retire/restore/delete-guard), `view list`, `inbox list/read/unread/snooze`, `--dry-run`, JSON envelopes, redaction, and exit-code discipline all behave as claimed against the real API. However, the spec'd `view get` by name/slug is non-functional (server-side query-complexity failure), which also breaks the required `4 NOT_FOUND` behavior for unknown view names, and `label list` cannot display retired labels.

VERDICT: FAIL

---

# Re-verification (post-fix)

- **Date:** 2026-11-25 (same day, after defect fixes were built)
- **Binary:** `./dist/bin/linear.js` rebuilt at 17:00 (newer than `src/` 16:43 / `src/core/errors.ts` 16:07) — no rebuild performed by this verifier
- **Workspace:** NineAI (`urlKey nineai`), team key `NIN`
- **Temp folder used (deleted at end):** `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/sec06-rv.wZK5nc`
- **Shared credential file stat (before AND after, identical):** `1795512864 99 /Users/IMTCRS/.config/linear-agent-mcp/client.json` — **unchanged**; `auth revoke` never run
- **Original findings above are retained unchanged as history.**

## R1. Source re-read (what the fixes look like)

- `src/modules/metadata/commands.ts`: `CUSTOM_VIEW_PAGE_SIZE = 50`; `resolveCustomViewNode` pages `client.customViews({first: 50, after})` (no more `first: 100`); `view list` fetches in ≤50-node chunks up to `--limit`; `inbox list` now calls `client.inboxNotifications({first, after, unreadOnly?})`.
- `src/modules/workspace/commands.ts` (label list): supplementary `client.client.rawRequest` query `issueLabels(filter:{id:{in:$ids}}, first:$first){ nodes { id retiredAt } }` enriches each page (SDK `IssueLabel` fragment omits `retiredAt`).
- `src/core/errors.ts`: `InvalidInputLinearError` whose message matches `/entity not found|could not find referenced/i` → `NOT_FOUND` (4); `LinearError` forbidden branch now also matches `error.type`/`errors[].type` ∈ {`forbidden`,`featurenotaccessible`} and message wording `not allowed` / `permission denied` → `FORBIDDEN` (3).
- SDK check: `node_modules/@linear/sdk` exposes `inboxNotifications`, `customViewCreate`, `customViewDelete`.

## R2. Unit tests

```
npx vitest run tests/sec-06-metadata   → Test Files 1 passed (1), Tests 1 passed (1), exit 0
npx vitest run                         → Test Files 13 passed (13), Tests 26 passed (26), exit 0
```

## R3. Setup

```
TMP=$(mktemp -d …/sec06-rv.XXXXXX)
./dist/bin/linear.js --cwd "$TMP" auth login --app \
  --client-credentials-file "$HOME/.config/linear-agent-mcp/client.json" \
  --storage file --json --non-interactive        → exit 0 (NineAI workspace)
./dist/bin/linear.js --cwd "$TMP" label list --json  → exit 0, exactly the original 3 labels
  (Improvement, Bug, Feature — no leftover probe labels)
```

## R4. Defect-by-defect re-test

### D1 (HIGH) — `view get <name|slug>` + `view list` complexity — **FIXED**

| Command | Before | Now |
|---|---|---|
| `view get "Active Bugs" --json` | exit 5 `Query too complex` | **exit 4** `NOT_FOUND: Custom view 'Active Bugs' not found.` (stderr JSON, stdout empty) |
| `view get "nope-not-a-view" --json` | exit 5 | **exit 4** `NOT_FOUND` |
| `view get "00000000-…-099" --json` (UUID) | exit 4 | **exit 4** `NOT_FOUND` (unchanged) |
| `view get <existing>` — success path | unreachable | **exit 0** (see below) |

Success path (previously untestable — workspace had no saved views). Created a temporary probe view via the CLI's own AST-guarded raw API (write performed solely to exercise D1, deleted immediately after):

```
api mutation --allow-mutation --query 'mutation { customViewCreate(input: { name: "Sec06 RV Probe View" }) { success customView { id name slugId modelName } } }' --json
  → exit 0, id d5ab5111-5939-4c39-9b7e-a9b4e85075bd, slugId 57066b6e4377
view get "Sec06 RV Probe View" --json   → exit 0: {id, name, slugId, modelName, shared, description, filterData:{}}
view get "57066b6e4377" --json (slug)   → exit 0: same node
view get "d5ab5111-…" --json (UUID)     → exit 0: same node
view list --limit 100 --json            → exit 0: returns the probe view (count 1)
Cleanup: api mutation --allow-mutation --query 'mutation { customViewDelete(id: "d5ab5111-…") { success } }' --json
  → exit 0 {success:true}; view list --json → data:[]; view get "Sec06 RV Probe View" → exit 4
```

→ **D1 PASS.** Name, slug, and UUID lookups all reach matching/return logic; unknown references yield exit 4, not 5.

### D2 (MEDIUM) — `label list` retiredAt always null — **FIXED**

```
label create --name "Sec06 RV RetiredProbe" --color "#0984E3" --description "re-verify D2" --json → exit 0 (id deb80fc1-818d-44dc-8a4a-ecbfb69fd4e9)
label list --name "Sec06 RV RetiredProbe" --json            → exit 0, retiredAt: null   (baseline)
label archive "Sec06 RV RetiredProbe" --json                → exit 0, {retired: true}
label list --name "Sec06 RV RetiredProbe" --json            → exit 0, retiredAt: "2026-11-25T09:09:10.504Z"  ← non-null
label list --name "Sec06 RV RetiredProbe" --include-archived --json → exit 0, retiredAt: "2026-11-25T09:09:10.504Z"
Cleanup: label archive "Sec06 RV RetiredProbe" --delete --yes --json → exit 0 {deleted: true}
label list --include-archived --json  → exit 0, back to exactly Improvement / Bug / Feature (count 3)
label list --name "Sec06" --include-archived --json → data: []  (no probe labels remain)
```

→ **D2 PASS.** Supplementary raw query works; `RETIRED` would now render `true`. Retired labels also still appear in the default (non-`--include-archived`) listing with the correct timestamp.

### D3 (MEDIUM/LOW) — team label create permission denial → exit 1 — **FIXED**

```
label create --name "Sec06 RV TeamLabel" --team NIN --color "#EB5757" --json
  → exit 3, stderr: {"ok":false,"error":{"code":"FORBIDDEN","exitCode":3,
      "message":"Not allowed to take action - You are not allowed to create labels in this team."}}
```

Same API permission denial as before, now mapped to `3 FORBIDDEN` instead of `1 INTERNAL_ERROR`. No label created. → **D3 PASS.** (Team-scoped creation remains blocked by the shared app credential — an environment constraint, unchanged.)

### D4 (LOW) — unknown inbox notification id → exit 5 — **FIXED**

```
inbox read 00000000-0000-4000-8000-000000000099 --json       → exit 4, NOT_FOUND "Entity not found: Notification - Could not find referenced Notification."
inbox snooze 00000000-0000-4000-8000-000000000099 --until +1h --json → exit 4, NOT_FOUND (same message)
```

→ **D4 PASS.** No mutation possible on a nonexistent id.

### D5 (LOW) — `view list --limit ≥86` rejected by server — **FIXED**

```
view list --limit 100 --json → exit 0, {"ok":true,"data":[],…}   (was exit 5 Query too complex)
view list --limit 250 --json → exit 0, {"ok":true,"data":[],…}
view list --limit 100 --json (with the probe view present) → exit 0, returns the view, count 1
```

→ **D5 PASS.** Chunked fetching (≤50/request) works with data present.

### D6 (LOW) — `inbox list --unread` client-side single-page filter — **FIXED (behavioral test)**

Baseline in this session: `inbox list --json` → 2 notifications (both unread); `inbox list --unread --json` → count 2.

```
inbox list --unread --json            → exit 0, unreadCount=2, ids [69d99567…, d017e784…]
inbox read 69d99567-f288-4fa1-9942-f05059ff3efb --json → exit 0 {read:true}
inbox list --unread --json            → exit 0, unreadCount=1, ids [d017e784…]   ← dropped as expected
inbox unread 69d99567-… --json        → exit 0 {read:false}
inbox list --unread --json            → exit 0, unreadCount=2, ids [69d99567…, d017e784…]  ← restored
```

Count dropped and restored exactly; state fully restored (original: `read:false, readAt:null`). Source re-read confirms `unreadOnly: true` is now passed server-side to `client.inboxNotifications(...)` (the client-side `filter(!read)` remains only as defense-in-depth). → **D6 PASS.**

**Observation O1 (informational, not a defect against the stated fix):** switching from `notifications` to `inboxNotifications` changed *which* notifications are listed. Verified with raw read-only queries:

```
api query 'query { notifications(first:10){ nodes { id readAt createdAt } } }'   → 3 nodes (incl. 1f61d5f5…, readAt null)
api query 'query { inboxNotifications(first:10){ nodes { id readAt } } }'        → 2 nodes (1f61d5f5… absent)
```

So `inbox list` now returns 2 of the 3 individual notifications that still exist (server-side grouped-Inbox semantics, not CLI filtering). This matches the command's "Linear Inbox" contract and is the intended consequence of the D6 fix, but it is a visibility change versus the first verification run (which listed 3 via `notifications`). Worth a line in the changelog; no action required for verdict purposes.

## R5. Regression spot-checks

| Check | Exit | Notes |
|---|---|---|
| `label list --json` | 0 | 3 baseline labels, structured JSON |
| `label create … --dry-run --json` | 0 | previews `{name, teamId, color}`; `label list --name "Sec06 RV DryRun"` → `data: []` (no mutation) |
| `inbox list --limit 0 --json` | 5 | `VALIDATION_ERROR: Invalid --limit '0'…` |
| `inbox snooze <id> --until not-a-time --json` | 5 | `VALIDATION_ERROR: Invalid --until …` |
| `auth login --app … --storage file --json --non-interactive` | 0 | |
| `auth logout --json` | 0 | `loggedOut: true`; only `.gitignore` left in folder |
| Secrets grep over every `s6rv-*` stdout/stderr captured | — | **NO_SECRET_MATCHES_IN_REVERIFY_OUTPUTS** |
| Shared `client.json` stat | — | `1795512864 99` before and after (unchanged) |
| Temp folder `sec06-rv.wZK5nc` | — | deleted (`ls` → No such file or directory) |

Exit codes observed this round: `0, 3, 4, 5` — all within the documented README set (0–10); every `--json` error payload's `error.exitCode` matched the process exit status.

## R6. Re-verification summary

| Defect | Result | Evidence |
|---|---|---|
| D1 `view get` name/slug always exit 5 | **PASS — fixed** | unknown name → 4; existing view by name/slug/UUID → 0 with `filterData`; post-delete → 4 |
| D2 `label list` retiredAt always null | **PASS — fixed** | `retiredAt: "2026-11-25T09:09:10.504Z"` shown after retire; probe label deleted, baseline 3 labels restored |
| D3 permission denial → exit 1 | **PASS — fixed** | team label create → exit 3 `FORBIDDEN` |
| D4 unknown inbox id → exit 5 | **PASS — fixed** | `inbox read`/`inbox snooze` on bogus UUID → exit 4 `NOT_FOUND` |
| D5 `view list --limit ≥86` → exit 5 | **PASS — fixed** | `--limit 100` and `--limit 250` → exit 0 (with and without data) |
| D6 `--unread` client-side page filter | **PASS — fixed** | unread count 2 → 1 → 2 across read/unread round trip; `unreadOnly: true` server-side confirmed in source |

All six defects verified fixed by execution. Workspace left in its original state (3 labels; probe custom view deleted; notification read/unread state restored), shared credential file untouched, temp folder removed. One informational observation (O1) about `inboxNotifications` vs `notifications` coverage is noted above and does not contradict the stated fix.

VERDICT: PASS
