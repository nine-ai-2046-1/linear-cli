# Section 3: Issues and Relations — Independent Verification Report

- **Date:** 2026-11-25
- **Verifier:** independent subagent (no prior context; all results below come from real executions, not from reading claims)
- **Project root:** `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli`
- **Binary under test:** `./dist/bin/linear.js` (built `dist/`, `--version` → `0.1.0`)
- **Workspace under test:** NineAI (`urlKey nineai`), team key `NIN`
- **Temp folder:** `mktemp -d /tmp/sec03-verify.XXXXXX` → `/tmp/sec03-verify.kdXDQk` (used with `--storage file`, deleted at the end)

---

## 1. Claims under review

Read from `openspec/changes/sec-03-issues-and-relations/`:

- **proposal.md** — adds `src/modules/issues/{commands,filter}.ts`, read commands (`list`, `mine`, `search`, `get`, `children`, `relation list`), create/update, lifecycle shortcuts, sharing, relations; registers `issue` in `src/cli/app.ts`.
- **tasks.md** — tasks 1.1, 2.1, 2.2 marked `[x]` (filters + read commands, write commands, rebuilt `dist/` + vitest + isolated-folder verification).
- **specs/issue-lifecycle-and-relations/spec.md** — key verifiable claims:
  1. combinable AND filters; `issue list --assignee me --unassigned` → exit `5` `VALIDATION_ERROR`;
  2. `issue create` / partial non-destructive updates;
  3. `issue delete` without `--yes` → exit `5`, no deletion;
  4. `children` / `parent set` / `relation list|add|remove`, with `blocked-by` normalized to `blocks` with swapped ids.

Source read to understand behavior: `src/modules/issues/{filter,commands}.ts`, `src/core/{errors,resolvers,client}.ts`, `src/cli/app.ts`.

Exit-code contract (`src/core/errors.ts`, matches README line 70): `0` success, `1` INTERNAL_ERROR, `2` AUTH_REQUIRED, `3` FORBIDDEN, `4` NOT_FOUND, `5` VALIDATION_ERROR, `6` AMBIGUOUS_RESOURCE, `7` RATE_LIMITED, `8` OUTCOME_UNKNOWN, `9` UNSUPPORTED_BY_PUBLIC_API, `10` NETWORK_ERROR.

---

## 2. Unit tests

Command (from project root):

```
npx vitest run tests/sec-03-issues
```

Observed output:

```
 RUN  v5.1.1 /Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli
 Test Files  2 passed (2)
      Tests  2 passed (2)
   Duration  199ms
VITEST_EXIT=0
```

**Result: 2 files / 2 tests passed, 0 failed, exit 0.** Note: each file contains a single large `it(...)` that chains many assertions against a mocked harness (`tests/helpers/cli-harness.js`), so pass count is 2 but assertion coverage is broad (filter construction, conflict rejection, search args, get/children/relation list, create input shape, label add/remove idempotency, lifecycle guards, blocked-by normalization). Because everything is mocked, E2E runs below were required.

---

## 3. Authentication (isolated, `--storage file`)

```
./dist/bin/linear.js --cwd /tmp/sec03-verify.kdXDQk auth login --app \
  --client-credentials-file "$HOME/.config/linear-agent-mcp/client.json" \
  --storage file --json --non-interactive
```

Observed: `EXIT=0`, JSON `{"ok":true,"data":{"authenticated":true,...,"workspace":{"name":"NineAI","urlKey":"nineai",...}}}`; wrote only `/tmp/.../.linear/{auth.json,credentials.json,.gitignore}`.

**`linear auth revoke` was never run.** All test commands used `--storage file` in the temp folder.

Baseline of the shared MCP credential file (before any run):

```
$ stat -f '%m %z %N' ~/.config/linear-agent-mcp/client.json
1795512864 99 /Users/IMTCRS/.config/linear-agent-mcp/client.json
$ shasum -a 256 ~/.config/linear-agent-mcp/client.json
ba39ab1848ba4e52c275dee90a63b0c0a991ce1ff3b463e4e2e94e7625ebedeb
```

---

## 4. End-to-end runs (all through `./dist/bin/linear.js --cwd <tmp> …`)

### 4.1 Structured JSON + exit 0

| Command | Exit | Observed |
|---|---|---|
| `issue list --json --team NIN --limit 3` | `0` | Single JSON doc `{"ok":true,"data":[…]}` with full `IssueSummaryDto` rows (id/identifier/title/status/statusType/priorityName/assignee/team/labels/url/…). stderr empty. |
| `issue list --team NIN --limit 2 --json` | `0` | `pageInfo:{hasNextPage:true,endCursor:"226ebc79-…",count:2}` |
| `issue mine --team NIN --limit 2 --json` | `0` | `{"ok":true,"data":[],"pageInfo":{…,"count":0}}` (app account owns no issues) |
| `issue search "onboarding" --team NIN --limit 2 --json` | `0` | 2 rows, NIN-16/NIN-15 |
| `issue get NIN-18 --json` | `0` | Full detail incl. `description`, `parent/cycle/milestone/attachments` |
| `issue children NIN-18 --json` | `0` | `data: []`, `count: 0` |
| `issue relation list NIN-18 --json` | `0` | `data: []` |

Human (non-JSON) output also works: table with `ID/STATUS/PRIORITY/ASSIGNEE/TITLE` plus `More results available. Next cursor: 226ebc79-…`, exit 0; human error line `Error [NOT_FOUND]: Issue 'NIN-999999' not found.` with exit 4.

### 4.2 Pagination (cursor round-trip)

```
issue list --team NIN --limit 2 --json          → endCursor 226ebc79-8db5-403f-844c-cbba7a087dde
issue list --team NIN --limit 2 --cursor <that> → EXIT=0, page2 ids: NIN-16,NIN-15, next 38ebddf8-…
```

(A first attempt with a mistyped cursor returned exit `5` with `VALIDATION_ERROR "after is not a valid pagination cursor identifier"` — correct rejection of a bad cursor, not a defect.)

### 4.3 Filter behavior

| Command | Exit | Observed |
|---|---|---|
| `issue list --assignee me --unassigned --json` | **`5`** | `VALIDATION_ERROR` "Cannot combine '--assignee' and '--unassigned'. Choose one." — matches spec scenario exactly |
| `issue mine --unassigned --json` | `5` | "'linear issue mine' cannot be combined with '--unassigned'." |
| `issue list --team NIN --status "Done" --limit 5 --json` | `0` | Only NIN-18 (status Done) |
| `issue list --team NIN --status "In Progress" --limit 5 --json` | `0` | empty (no such state) |
| `issue list --team NIN --priority high --limit 5 --json` | `0` | 4 rows, all `priority:2 / High` |
| `issue list --team NIN --label Feature --limit 5 --json` | `0` | 1 row (NIN-11) with `labels:["Feature"]` |
| `issue list --team NIN --unassigned --limit 5 --json` | `0` | empty |
| `issue list --team NIN --updated-after -P7D --limit 5 --json` | `0` | 5 rows, `hasNextPage:true` |
| `issue list --limit abc --json` | `5` | "Invalid --limit 'abc': expected integer." |
| `issue bogus-subcommand --json` | `5` | "unknown command 'bogus-subcommand'" |
| `issue list --priority nope --json` | `5` | "Invalid priority 'nope': expected none\|urgent\|high\|medium\|low or 0..4." |

### 4.4 Unknown issue → exit 4 NOT_FOUND

| Command | Exit | Observed |
|---|---|---|
| `issue get NIN-999999 --json` | **`4`** | `{"ok":false,"error":{"code":"NOT_FOUND","exitCode":4,"message":"Issue 'NIN-999999' not found."}}` (JSON on **stderr**, stdout empty) |
| `issue get INVALID-REF --json` | `4` | same shape |
| `issue get 00000000-0000-4000-8000-000000000000 --json` | `4` | same shape |
| `issue relation list NIN-999999 --json` | `4` | same shape |

### 4.5 AMBIGUOUS_RESOURCE → exit 6

```
issue share NIN-18 "同學" --dry-run --json   → EXIT=6
AMBIGUOUS_RESOURCE: User '同學' matched 5 records; specify a UUID or unique key.
details.candidates[] = {id,name,displayName,email} ×5
```

### 4.6 AUTH_REQUIRED → exit 2

```
FRESH=$(mktemp -d); ./dist/bin/linear.js --cwd $FRESH issue list --json
EXIT=2  AUTH_REQUIRED "No Linear authentication found in folder '…' (expected …/.linear/auth.json)…"
```

### 4.7 `--dry-run` performs no mutation and previews input

| Command | Exit | Observed preview |
|---|---|---|
| `issue create --team NIN --title "SEC03 VERIFY DRY RUN MUST NOT CREATE" --description "…" --priority low --json --dry-run` | `0` | `{"ok":true,"dryRun":true,"operation":"issue.create","data":{"parameters":{teamId, title, description, priority:4}}}` |
| `issue update NIN-18 --title "changed by dry run" --json --dry-run` | `0` | `issue.update` preview with `{id, identifier, input:{title}}` |
| `issue status NIN-18 Backlog --json --dry-run` | `0` | `issue.status` preview with `stateId` resolved |
| `issue label add NIN-18 Feature --json --dry-run` | `0` | `issue.label.add` preview with resolved `addedLabelIds` |
| `issue relation add NIN-18 --type blocked-by --target NIN-17 --json --dry-run` | `0` | `issue.relation.add` preview shows **normalized direction**: `issueId: <NIN-17 uuid>, relatedIssueId: <NIN-18 uuid>, type: "blocks"` — matches spec scenario |
| `issue parent set NIN-18 NIN-17 --json --dry-run` / `… none` | `0` | preview with `parentId` set / `null` |
| `issue delete NIN-18 --yes --json --dry-run` | `0` | `issue.delete` preview only |
| `issue relation remove <id> --json --dry-run` | `0` | `issue.relation.remove` preview only |

**No-mutation proof for dry-run create:** after the dry-run, `issue list --team NIN --sort created --limit 5 --json` still showed newest = `NIN-18 (2026-11-25T04:47:58Z)`, and `issue search "MUSTNOTCREATEVERIFYTOKEN" --json` returned `count: 0`. Afterwards a real `issue get NIN-18` showed `parent: null` after the `parent set … --dry-run` calls.

### 4.8 Destructive guard (spec scenario)

```
issue delete NIN-18 --non-interactive --json   → EXIT=5
VALIDATION_ERROR "Destructive operation (delete issue 'NIN-18') requires explicit '--yes' flag (or '--dry-run' to preview)."
```
No deletion occurred (NIN-18 still present afterwards).

### 4.9 Relation type validation

```
issue relation add NIN-18 --type bogus --target NIN-17 --json → EXIT=5
"Invalid relation --type 'bogus': expected blocks|blocked-by|related|duplicate."
```

### 4.10 Real writes performed (and cleaned up)

Per instructions, writes were minimized; three real write cycles were executed to prove the API path works and then cleaned up:

1. **Create + label + delete:**
   - `issue create --team NIN --title "[sec03-verify] temp issue - safe to delete" … --json` → `EXIT=0`, created **NIN-19** (`58d4cfc8-0da2-4d51-8783-f8a8a66bfdef`), status Triage, priority Low.
   - `issue get NIN-19` → `EXIT=0`, found.
   - `issue label add NIN-19 Feature --json` → `EXIT=0`; re-get showed `labels:["Feature"]` (non-destructive add works against the real API).
   - **Cleanup:** `issue delete NIN-19 --yes --json` → `EXIT=0`, `{"deleted":true}`.
2. **Relation add/list/remove:** `issue relation add NIN-18 --type related --target NIN-17 --json` → `EXIT=0`, relation id `0b3f20fe-1238-4cbc-9fa6-6ace888f36b0`; `issue relation list NIN-18` showed `direction:"outbound"` and `issue relation list NIN-17` showed `direction:"inbound"` with the mirrored ids; **cleanup:** `issue relation remove 0b3f20fe-… --json` → `EXIT=0` `{"removed":true}`, both lists then returned `data: []`.
3. No other real mutations were made (all other write commands were run with `--dry-run` or blocked by validation/guards).

**Post-cleanup state of NIN-19:** `issue get NIN-19` still returns the record with `archivedAt` set (Linear trash semantics — see defect D1), it no longer appears in default `issue list` or `issue search`, and it shows only under `issue list --include-archived` (`count 19 … NIN-19(arch)`).

---

## 5. Exit codes vs documented set

Observed live: **`0`, `2`, `4`, `5`, `6`** — each with a matching `error.exitCode` in the JSON envelope (stderr) and the documented `error.code`.

Mapping for the remaining codes was verified by *executing* the compiled module (not just reading source):

```
$ node --input-type=module -e "import {ExitCode,CliError} from './dist/core/errors.js'; …"
SUCCESS=0 -> undefined        (no CliError for success; correct)
INTERNAL_ERROR=1 -> 1
AUTH_REQUIRED=2 -> 2
FORBIDDEN=3 -> 3
NOT_FOUND=4 -> 4
VALIDATION_ERROR=5 -> 5
AMBIGUOUS_RESOURCE=6 -> 6
RATE_LIMITED=7 -> 7
OUTCOME_UNKNOWN=8 -> 8
UNSUPPORTED_BY_PUBLIC_API=9 -> 9
NETWORK_ERROR=10 -> 10
```

This matches README line 70 (`0,1,2,…,10`) and the spec's failure set `{0,2,3,4,5,6,7,8,9,10}` (plus `1` internal, also documented). Codes `1, 3, 7, 8, 9, 10` were **not triggered end-to-end** in this run: they require server-side faults (403/429/create-timeout), an unsupported-by-API mutation (none exists in sec-03 commands), or transport failure; they are unreachable on demand without fault injection. No *undocumented* exit code was ever observed.

---

## 6. Secret / token hygiene

Captured stdout+stderr of `issue list|get|search|mine|children|relation list|create --dry-run`, the validation/NOT_FOUND/AMBIGUOUS/AUTH_REQUIRED failures, and `auth login/status` output into one file and grepped:

```
grep -inE 'lin_api_[A-Za-z0-9]|accesstoken|refreshtoken|apikey|api_key|bearer |client_secret|secret|"token"' → (none)
```

No API key, access token, bearer value or client secret appeared in any stdout/stderr. Error envelopes contain only `code/exitCode/message/details`. The only personal data seen is workspace user `email`s inside the intentional `AMBIGUOUS_RESOURCE` candidates list (needed for disambiguation) — not credentials.

---

## 7. Shared MCP config integrity

```
before: 1795512864 99 …/client.json   sha256 ba39ab1848ba4e52c275dee90a63b0c0a991ce1ff3b463e4e2e94e7625ebedeb
after : 1795512864 99 …/client.json   sha256 ba39ab1848ba4e52c275dee90a63b0c0a991ce1ff3b463e4e2e94e7625ebedeb
```

**Byte-identical: mtime, size and SHA-256 unchanged.** `auth revoke` was never invoked; only `auth login`/`auth logout` were used.

---

## 8. Cleanup performed

```
./dist/bin/linear.js --cwd /tmp/sec03-verify.kdXDQk auth logout --json
→ EXIT=0 {"loggedOut":true,"folder":"/private/tmp/sec03-verify.kdXDQk", …}
→ .linear/ reduced to just .gitignore (auth.json/credentials.json removed)
rm -rf /tmp/sec03-verify.kdXDQk        → removed
rm -rf /tmp/sec03-noauth.FARqiz        → removed (fresh-folder exit-2 test)
```

No file outside `reports/sec-03-verify.md` was modified by this verification.

---

## 9. Defects / observations

| ID | Severity | Finding |
|---|---|---|
| **D1** | **Low** | `issue delete <id> --yes` returns `deleted: true`, but the issue remains retrievable afterwards via `issue get <id>` (returned full payload with `archivedAt` set) and appears in `issue list --include-archived`. It disappears from default lists/search. This mirrors Linear's trash semantics (no permanent-purge mutation exists in the public API), but the CLI's `deleted:true` wording implies permanent removal — callers using `get` to verify deletion will see exit `0`, not `4`. Verified with the real API on NIN-19. |
| **D2** | Info | `issue search` with nonsense tokens returns unrelated issues (e.g. `"SEC03 VERIFY DRY RUN MUST NOT CREATE"` → NIN-11; `"sec03-verify"` → NIN-18, NIN-11), while `"MUSTNOTCREATEVERIFYTOKEN"` → 0 results. The CLI just forwards the term; this is Linear's backend search ranking, not CLI logic. Users should not treat search hits as exact-match proof. |
| **D3** | Info | NIN-18's `updatedAt` changed twice during the test window (`04:55:13Z → 06:33:17Z → 06:40:34Z`). The `06:40:34Z` change coincides with my own relation add/remove on that issue (relations touch the issue). The `06:33:17Z` change is **not attributable to any command I ran** — everything I executed in that window was read-only, a `--dry-run`, or aborted by validation/guard before any mutation; the workspace is shared with other agents, so concurrent activity is the likely cause. No evidence of unintended mutation by this CLI. |
| **D4** | Info | The sec-03 unit suite is only **2 test cases** (1 per file), each a long chained assertion against a mocked harness. It passes cleanly but gives no API-level coverage — the E2E behavior verified above is not guarded by the unit tests. |
| **D5** | Info | JSON error envelopes are written to **stderr** with empty stdout (success JSON goes to stdout). Automation must read both streams; `--json` alone on stdout will be empty for failures. Consistent with the sec-01 runtime design, but worth documenting. |

No blocking or high-severity defects found.

---

## 10. Requirement-by-requirement verdict

| Claim | Result |
|---|---|
| `issue list --json` → structured JSON, exit 0 | **PASS** (observed, incl. pageInfo/cursors) |
| Combinable filters behave (status/label/priority/unassigned/updated-after) | **PASS** (observed, correct result sets) |
| Conflicting `--assignee` + `--unassigned` → exit 5 `VALIDATION_ERROR` | **PASS** |
| `issue get <unknown-id>` → exit 4 `NOT_FOUND` | **PASS** (3 different bad refs, all exit 4) |
| `--dry-run` on create performs no mutation and previews input | **PASS** (preview shown; no issue created; token search 0 hits) |
| Other write `--dry-run` previews (update/status/label/relation/parent/delete) | **PASS** (all exit 0, `dryRun:true`, resolved ids, no mutation) |
| `delete` without `--yes` → exit 5, no deletion | **PASS** |
| `blocked-by` relation normalized to `blocks` with swapped ids | **PASS** (observed in dry-run preview; `related` relation also verified live and cleaned up) |
| `children` / `relation list` work | **PASS** (exit 0, correct shape; direction rendering verified live) |
| Exit codes match documented set | **PASS** (live: 0/2/4/5/6; mapping 1,3,7,8,9,10 verified by executing compiled `ExitCode`/`CliError`; no undocumented code observed) |
| No secrets/tokens in output | **PASS** (grep over captured outputs: no matches) |
| Shared `~/.config/linear-agent-mcp/client.json` unchanged | **PASS** (mtime/size/SHA-256 identical before & after) |
| Unit tests pass | **PASS** (2 files, 2 tests, exit 0) |
| Cleanup (logout, temp folders deleted) | **PASS** |
| Real write path works | **PASS** (create→label→delete NIN-19; relation add→list→remove — all cleaned up) |

Minor issues D1–D5 above are Low/Info and do not invalidate any spec claim.

VERDICT: PASS

---
---

# Re-verification (post-fix) — 2026-11-25

Scope: re-verify **D1** (`issue delete --yes` wording implied permanent removal) after the fix, re-check the exit-code observations from the original report (a related `normalizeError` change now maps Linear permission denials → exit `3` and `Entity not found: …` InvalidInput errors → exit `4`), and re-run the unit tests. Original findings above are kept unchanged as history.

## R1. What the fix claims (verified against source)

Read in `src/modules/issues/commands.ts` (lines 793–808):

- `.description("Move an issue to trash (requires --yes; recoverable until Linear purges it)")`
- `.option("--yes", "Confirm moving the issue to trash")`
- JSON payload: `ctx.output.success({ id, identifier, deleted, trashed }, …)`
- human output: `Moved <id> to trash (Linear keeps it recoverable until purge)`
- comment at line 805: "Linear moves deleted issues to trash: they remain fetchable (with archivedAt) until Linear purges them…"

Same wording in `src/modules/planning/commands.ts` (lines 579–594) for `project delete`.
`src/core/errors.ts` `normalizeError` (lines 113–162): `InvalidInputLinearError` whose message matches `/entity not found|could not find referenced/i` → `NOT_FOUND` (exit 4), otherwise `VALIDATION_ERROR`; `LinearError` forbidden detection now also matches `errType === "forbidden" | "featurenotaccessible"` and message wording `not allowed` / `permission denied` → `FORBIDDEN` (exit 3).

## R2. Unit tests

```
npx vitest run tests/sec-03-issues        → Test Files 2 passed (2), Tests 2 passed (2), exit 0
npx vitest run                            → Test Files 13 passed (13), Tests 26 passed (26), exit 0
```

The **full project suite is 26 tests, all passing**; the `tests/sec-03-issues` subset itself still contains 2 test cases (the "26" total comes from all 13 test files, incl. `tests/sec-01-auth/runtime.test.ts` which now covers both new mappings: "Not allowed to take action" → `FORBIDDEN` and "Entity not found: Notification" → `NOT_FOUND`, per `tests/sec-01-auth/runtime.test.ts:75-92`).

## R3. Environment / hygiene (fresh run)

- Baseline `~/.config/linear-agent-mcp/client.json`: `1795512864 99` … sha256 `ba39ab1848ba4e52c275dee90a63b0c0a991ce1ff3b463e4e2e94e7625ebedeb`
- Fresh folder `mktemp -d /tmp/sec03-reverify.XXXXXX` → `/tmp/sec03-reverify.loCyB2`
- `./dist/bin/linear.js --cwd <tmp> auth login --app --client-credentials-file "$HOME/.config/linear-agent-mcp/client.json" --storage file --json --non-interactive` → `EXIT=0`, `authenticated: true`, workspace `nineai`
- `auth revoke` never run.
- After: `auth logout --json` → `EXIT=0` `{"loggedOut":true,…}`, `.linear/` reduced to `.gitignore`; `rm -rf` temp folders (incl. the no-auth probe folder) → removed.
- Shared config after: `1795512864 99` … same sha256 → **byte-identical (mtime/size/SHA-256 unchanged)**.
- Secret grep over login + list/get/delete outputs for `lin_api_|accessToken|refreshToken|apiKey|bearer |client_secret|"token"` → **(none)**.

## R4. D1 re-test — real delete cycle

```
issue create --team NIN --title "[sec03-reverify] temp issue - safe to delete" … --json  → EXIT=0 → NIN-20 (42927ba3-…)
issue delete NIN-20 --non-interactive --json                                              → EXIT=5 (guard intact)
   VALIDATION_ERROR "Destructive operation (delete issue 'NIN-20') requires explicit '--yes' flag …"
issue delete NIN-20 --yes --json --dry-run                                                → EXIT=0, dryRun preview only
issue delete NIN-20 --yes --json                                                          → EXIT=0
   {"ok":true,"data":{"id":"42927ba3-…","identifier":"NIN-20","deleted":true,"trashed":true}}   ← new field present
issue create … "[sec03-reverify] human output probe" → NIN-21;  issue delete NIN-21 --yes   → EXIT=0
   human stdout: "Moved NIN-21 to trash (Linear keeps it recoverable until purge)"            ← new wording
issue delete --help                                                                       → "Move an issue to trash (requires --yes; recoverable until Linear purges it)"
project delete --help                                                                     → "Move a project to trash (requires --yes; recoverable until Linear purges it)"  ← same fix applied
```

Trash semantics confirmed (exactly what D1 described, now reported truthfully):

- `issue get NIN-20 --json` → `EXIT=0`, still fetchable with `archivedAt: "2026-11-25T09:22:35.413Z"`.
- `issue list --team NIN --limit 50 --json` (default) → count 8, **does not** contain NIN-20 or NIN-21.
- `issue search "sec03-reverify" --json` → 0 hits (trashed issues are not searchable).
- `issue list --team NIN --include-archived --limit 50 --json` → archived set includes `NIN-21, NIN-20, NIN-19` (the trashed ones) plus older archived issues.

**D1: FIXED** — description, option help, human output, and JSON payload are now truthful about trash/recoverability, and `trashed: true` is present alongside `deleted: true`. Behavior (fetchable with `archivedAt`, hidden from default list/search) is unchanged and consistent with the wording.

## R5. Exit codes re-checked after the `normalizeError` change

| Command | Exit | Code / message |
|---|---|---|
| `issue list --json --team NIN --limit 2` | **0** | `ok:true` + rows + pageInfo |
| `issue create … --json --dry-run` | **0** | `dryRun:true` preview (no mutation; follow-up `issue search "SEC03REVERIFYDRYRUNNOCREATE"` → count 0) |
| `issue list --assignee me --unassigned --json` | **5** | `VALIDATION_ERROR` "Cannot combine '--assignee' and '--unassigned'." |
| `issue mine --unassigned --json` | **5** | `VALIDATION_ERROR` |
| `issue list --limit abc --json` / `issue bogus --json` | **5** | `VALIDATION_ERROR` |
| `issue delete NIN-20 --non-interactive --json` | **5** | `VALIDATION_ERROR` (destructive guard) |
| `issue get NIN-999999 --json` | **4** | `NOT_FOUND` |
| `issue relation remove 00000000-0000-4000-8000-000000000000 --json` | **4** | `NOT_FOUND` "Entity not found: IssueRelation - …" — **this was exit 5 before the fix; live proof of the new InvalidInput → NOT_FOUND mapping** |
| `issue share NIN-18 "同學" --dry-run --json` | **6** | `AMBIGUOUS_RESOURCE` (5 candidate users) |
| `issue list --json` in a folder with no auth | **2** | `AUTH_REQUIRED` |
| `issue list --expect-workspace wrong-ws --json` | **3** | `FORBIDDEN` (identity guard) — live exit-3 confirmation |

Compiled mapping re-executed (`dist/core/errors.js`): `1→1, 2→2, 3→3, 4→4, 5→5, 6→6, 7→7, 8→8, 9→9, 10→10` — matches README line 70; no undocumented code observed. Codes `1, 7, 8, 9, 10` still not triggerable on demand without server-side fault injection (unchanged from the original report); the `ForbiddenLinearError` → 3 and `Entity not found` → 4 paths are additionally covered by `tests/sec-01-auth/runtime.test.ts`.

All earlier exit-code observations still hold; the only behavioral delta is the intended `Entity not found` InvalidInput case moving `5 → 4` (more accurate), which I confirmed live.

## R6. Residual observations

- **D1 → fixed (verified above).**
- **D2** (backend `issue search` returns unrelated hits for nonsense tokens) — unchanged, informational.
- **D3** (NIN-18 `updatedAt` moved during the original run, not attributable to any command I ran) — unchanged, informational; nothing in this re-verification touched NIN-18 except read/`--dry-run` commands and a `--expect-workspace` guard failure.
- **D4** (sec-03 subset is 2 chained test cases; mocked only) — unchanged; note the full suite is 26 tests across 13 files and passes.
- **D5** (JSON error envelopes on stderr, stdout empty) — unchanged, informational.

No new defects found in this re-verification.

VERDICT: PASS
