# Section 5 Verification Report — Projects, Milestones, and Cycles

- **Date:** 2026-11-25
- **Verifier:** independent subagent (no prior context; all results below are from actual execution)
- **Project root:** `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli`
- **Binary under test:** `./dist/bin/linear.js` (built 2026-11-25 14:17)
- **Workspace:** NineAI (`urlKey: nineai`), team key `NIN`
- **Shared credential file baseline:** `~/.config/linear-agent-mcp/client.json` → **99 bytes, mtime=1795512864**

---

## 1. Claims read (openspec/changes/sec-05-projects-milestones-cycles/)

- `proposal.md`: adds `src/modules/planning/commands.ts` with project CRUD/status/archive/restore/delete/issues, milestone list/get/create/update, `cycle list|current|issues`, `update list|create|edit`, registered in `src/cli/app.ts`.
- `specs/.../spec.md`: 4 requirements with scenarios — create project with team/summary/content; `project delete` without `--yes` exits **5**; milestone create with `targetDate`; `cycle current`/`cycle issues current` resolve the active cycle; `update create` publishes health update.
- `tasks.md`: tasks 1.1, 2.1, 2.2 all checked `[x]`; workflow note says keep change unarchived pending user review.
- Source reviewed: `src/modules/planning/commands.ts` (1007 lines), `src/core/errors.ts` (exit-code map), `src/core/resolvers.ts` (project/cycle/status/team/user resolution), `src/cli/context.ts` (`requireDestructiveConfirmation`), `src/cli/app.ts` (commander error → exit 5), `src/core/output.ts` (JSON envelope + secret redaction).

Documented exit-code set (docs/explorations/sec-01-foundation-and-auth.md): `0` success, `1` internal, `2` AUTH_REQUIRED, `3` FORBIDDEN, `4` NOT_FOUND, `5` VALIDATION_ERROR, `6` AMBIGUOUS_RESOURCE, `7` RATE_LIMITED, `8` OUTCOME_UNKNOWN, `9` UNSUPPORTED_BY_PUBLIC_API, `10` NETWORK_ERROR. `src/core/errors.ts` maps exactly these.

---

## 2. Unit tests

Command (from project root):

```
npx vitest run tests/sec-05-planning
```

Observed output:

```
 Test Files  2 passed (2)
      Tests  2 passed (2)
   Duration  173ms
```

Exit code: **0**. Files: `tests/sec-05-planning/projects-milestones.test.ts`, `tests/sec-05-planning/cycles-updates.test.ts`.
Note: the suite is only **2 `it()` blocks** (one large scenario test per file), not 2 independent assertions per feature — breadth relies on those two scenario tests.

---

## 3. End-to-end CLI runs (fresh temp folder)

Temp folder: `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/sec05-verify.comAJp` (created with `mktemp -d`).

### 3.1 Authentication

```
./dist/bin/linear.js --cwd $TMP auth login --app \
  --client-credentials-file "$HOME/.config/linear-agent-mcp/client.json" \
  --storage file --json --non-interactive
```
→ exit **0**, JSON `ok:true`, `authType:"app"`, `storage:"file"`, workspace `NineAI / nineai`. No token/key in output.

### 3.2 Required checks

| # | Command (`--cwd $TMP` prefix omitted) | Exit | Observed |
|---|---|---|---|
| 1 | `--json project list --limit 5` | **0** | Structured JSON: `{"ok":true,"data":[],"pageInfo":{"hasNextPage":false,"endCursor":null,"count":0}}` |
| 2 | `--json cycle current --team NIN` | **4** | `{"ok":false,"error":{"code":"NOT_FOUND","exitCode":4,"message":"Team has no active current cycle."}}` — correct NOT_FOUND mapping; NineAI has **no cycles at all**, so this is an environment condition, not a resolution bug |
| 3 | `--json cycle list --team NIN --limit 5` | **0** | `data: []` (empty), structured JSON |
| 4 | `--json project get NO-SUCH-PROJECT-XYZ` | **4** | `NOT_FOUND` "Project 'NO-SUCH-PROJECT-XYZ' not found." |
| 5 | `--json cycle issues NOPE --team NIN` | **4** | `NOT_FOUND` "Cycle 'NOPE' not found." |
| 6 | `--json milestone list --project NO-SUCH-PROJECT-XYZ` | **4** | `NOT_FOUND` |
| 7 | `--json update list --project NO-SUCH-PROJECT-XYZ` | **4** | `NOT_FOUND` |
| 8 | `--json project delete NO-SUCH-PROJECT-XYZ --non-interactive` (no `--yes`) | **5** | `VALIDATION_ERROR` "Destructive operation … requires explicit '--yes' flag" — matches spec scenario (fails **before** resolving/deleting) |
| 9 | `--json --dry-run project create --name "SEC05 Verify Temp" --team NIN --summary … --priority low` | **0** | `{"ok":true,"dryRun":true,"operation":"project.create","data":{…parameters:{name,teamIds:["10b7ddf4…"],description,priority:4}}}` — resolved input previewed; **no mutation**: immediate `project list` still returned `[]` |
| 10 | `--json --dry-run project update d2209ad98395 --name "SHOULD NOT APPLY"` (real project) | **0** | Preview shows `{id, slugId, input:{name}}`; following `project get` showed name still `SEC05 Verify Temp` → **no mutation** |
| 11 | `--json --dry-run milestone update Alpha --project d2209ad98395 --name "SHOULD NOT APPLY"` | **0** | Preview; `milestone list` afterwards still showed `Alpha` → no mutation |
| 12 | `--json --dry-run update create --project d2209ad98395 --health onTrack --body …` | **0** | Preview `{projectId, body, health}`; `update list` afterwards still `[]` → no mutation |
| 13 | `--json update create --project NOPE --health banana --body test` | **5** | `VALIDATION_ERROR` "Invalid --health 'banana': expected onTrack \| atRisk \| offTrack." (validated before any session/mutation) |
| 14 | fresh unauthenticated folder: `--json project list` | **2** | `AUTH_REQUIRED` "No Linear authentication found in folder …" |
| 15 | `--json project create --name X --team NOPE` | **4** | `NOT_FOUND` "Team 'NOPE' not found." (no mutation) |
| 16 | `--json cycle list --team NOPE` / `cycle issues 999 --team NIN` / `cycle issues current --team NIN` | **4** | `NOT_FOUND` each |
| 17 | `--json cycle issues 12` (no `--team`) | **5** | `VALIDATION_ERROR` "Resolving cycle '12' … requires '--team <team>'." |
| 18 | `--json update edit 54b7f469-…` (no fields) | **5** | `VALIDATION_ERROR` "Provide '--body', '--body-file', or '--health' …" |
| 19 | `--json project create --name X` (missing `--team`) | **5** | `VALIDATION_ERROR` but message is the **server's** `Argument Validation Error - teamIds must contain at least 1 elements.` — see defect D1 |

### 3.3 Real write lifecycle (created, then cleaned up)

Because the workspace had no projects, I performed one real write lifecycle to prove the mutations work, then removed everything:

| Command | Exit | Observed |
|---|---|---|
| `--json project create --name "SEC05 Verify Temp" --team NIN --summary … --priority low` | 0 | Created `slugId d2209ad98395`, status `Backlog`, teams `[NIN]`, url `…/sec05-verify-temp-d2209ad98395` |
| `--json project get d2209ad98395` | 0 | Full record incl. `content`, `members`, `milestones` |
| `--json project list --team NIN --limit 5` | 0 | Returns the new project, `pageInfo.count=1` |
| `--json project issues d2209ad98395` | 0 | `data: []` (no issues in workspace) |
| `--json milestone create --project d2209ad98395 --name Alpha --target-date 2026-12-01` | 0 | `id 8f94f07d-…`, `targetDate "2026-12-01"` — matches spec scenario |
| `--json milestone list --project d2209ad98395` | 0 | Returns `Alpha` with targetDate |
| `--json milestone get Alpha --project d2209ad98395` | 0 | Resolves by name with `--project` |
| `--json project status d2209ad98395 started` | 0 | status → `In Progress` / `started` (uses `projectStatuses()`, not issue workflow states) |
| `--json project update d2209ad98395 --summary "updated by sec-05 verifier"` | 0 | summary updated |
| `--json update create --project d2209ad98395 --health atRisk --body …` | 0 | `id 54b7f469-…`, `health atRisk`, activity URL returned |
| `--json update list --project d2209ad98395` | 0 | One update, author `Local Agent MCP` |
| `--json update edit 54b7f469-… --health onTrack --body …` | 0 | health → `onTrack` |
| `--json project archive d2209ad98395` | 0 | `archived:true`; `project list --include-archived` shows `archivedAt` set |
| `--json project restore d2209ad98395` | 0 | `restored:true` |
| `--json project delete d2209ad98395 --yes` | 0 | `deleted:true` |
| `--json project get d2209ad98395` (after delete) | **4** | `NOT_FOUND` — gone from normal reads |
| `--json project delete d2209ad98395 --yes` (second time) | **4** | `NOT_FOUND`, no crash |
| `--json project list --limit 5` (final) | 0 | `data: []` — workspace back to its original state |

**Writes performed and cleaned up:** project `SEC05 Verify Temp` (slug `d2209ad98395`) incl. milestone `Alpha`, one project status update `54b7f469-…`, status/summary changes — all trashed via `project delete --yes`; verified `NOT_FOUND` afterwards. Nothing else in the workspace was modified. (Note: Linear keeps trashed projects visible to `project list --include-archived` — see defect D2; they cannot be purged via this API.)

### 3.4 Exit codes observed vs documented set

- **Exercised and correct:** `0`, `2` (AUTH_REQUIRED), `4` (NOT_FOUND), `5` (VALIDATION_ERROR).
- **Not reachable in this environment (not exercised):** `1`, `3` (needs a forbidden/mismatched-workspace case), `6` (needs an ambiguous duplicate match; NineAI has no duplicate-named entities), `7`, `8`, `9`, `10` (need rate-limit/timeout/unsupported/network faults). Mapping in `src/core/errors.ts` matches the documented table exactly; no observed command produced an undocumented exit code.

### 3.5 Secrets scan

All captured stdout/stderr (login + every command above) were grepped for `lin_api_*`, `lin_oauth_*`, `access_token`, `refresh_token`, `client_secret`, `Bearer <token>`:

```
NO SECRETS FOUND
```

`src/core/output.ts` additionally applies redaction (`redactString`/`redactValue`) to JSON output; nothing leaked in practice.

### 3.6 Shared MCP config integrity

| Checkpoint | Value |
|---|---|
| Before any runs | `99 bytes, mtime=1795512864` |
| After logout/cleanup | `99 bytes, mtime=1795512864, ctime=1795512864` |

**Unchanged.** `auth revoke` was never run.

### 3.7 Cleanup performed

- `./dist/bin/linear.js --cwd $TMP auth logout --json` → exit **0**, `loggedOut:true`.
- Temp folder `$TMP` removed (`rm -rf`, verified gone).
- No files modified outside `reports/sec-05-verify.md`.

---

## 4. Defects found

| ID | Severity | Defect |
|---|---|---|
| **D1** | **Low** | `project create --team` is declared `requiredOption` but with default `[]` (`collectRepeatable, []`), so Commander never treats it as missing. `linear project create --name X` (no `--team`) reaches the Linear API and fails with the **server's** message `Argument Validation Error - teamIds must contain at least 1 elements.` Exit code is still `5` (VALIDATION_ERROR) and no mutation occurs, so behavior is safe — but the client-side usage error/message expected from a "required" flag is absent (root cause: `src/modules/planning/commands.ts` line ~323). |
| **D2** | **Low / observation** | After `project delete --yes` (trash), the deleted project still appears in `project list --include-archived` (with `archivedAt` set), while `project get` and the default list correctly hide it. Consistent with Linear's trash semantics (the API returns it under `includeArchived`); may be API behavior rather than a CLI bug, but it means "deleted" ≠ "absent" in the archived listing. |
| **D3** | **Info** | `cycle current --team NIN` returns exit `4 NOT_FOUND` ("Team has no active current cycle.") because NineAI has **zero cycles**. Exit code matches the documented NOT_FOUND contract; however, the happy path of `cycle current` / `cycle issues current` (spec scenario "Inspect current team cycle and its issues") **could not be exercised end-to-end** in this workspace — only the resolution/error paths were verified live. |
| **D4** | **Info** | `--dry-run` resolves the target first, so `--dry-run project update <unknown-ref>` exits `4` instead of printing a preview. No mutation either way; arguably correct (fail fast on bad reference), noted for completeness. |

No High/Critical defects. All spec-delta scenarios that are exercisable in this workspace behaved as written.

---

## 5. Summary of commands run (exact)

```
npx vitest run tests/sec-05-planning                                   # exit 0, 2 files / 2 tests passed
./dist/bin/linear.js --cwd $TMP auth login --app --client-credentials-file "$HOME/.config/linear-agent-mcp/client.json" --storage file --json --non-interactive   # exit 0
./dist/bin/linear.js --cwd $TMP --json project list --limit 5                                            # 0
./dist/bin/linear.js --cwd $TMP --json cycle current --team NIN                                          # 4
./dist/bin/linear.js --cwd $TMP --json cycle list --team NIN --limit 5                                   # 0
./dist/bin/linear.js --cwd $TMP --json project get NO-SUCH-PROJECT-XYZ                                   # 4
./dist/bin/linear.js --cwd $TMP --json cycle issues NOPE --team NIN                                      # 4
./dist/bin/linear.js --cwd $TMP --json milestone list --project NO-SUCH-PROJECT-XYZ                      # 4
./dist/bin/linear.js --cwd $TMP --json update list --project NO-SUCH-PROJECT-XYZ                         # 4
./dist/bin/linear.js --cwd $TMP --json project delete NO-SUCH-PROJECT-XYZ --non-interactive              # 5
./dist/bin/linear.js --cwd $TMP --json --dry-run project create --name "SEC05 Verify Temp" --team NIN --summary … --priority low   # 0, no mutation
./dist/bin/linear.js --cwd $TMP --json --dry-run project update d2209ad98395 --name "SHOULD NOT APPLY"   # 0, no mutation
./dist/bin/linear.js --cwd $TMP --json --dry-run milestone update Alpha --project d2209ad98395 --name …  # 0, no mutation
./dist/bin/linear.js --cwd $TMP --json --dry-run update create --project d2209ad98395 --health onTrack --body …   # 0, no mutation
./dist/bin/linear.js --cwd $TMP --json update create --project NOPE --health banana --body test           # 5
./dist/bin/linear.js --cwd <no-auth-tmp> --json project list                                              # 2
# real write lifecycle (all cleaned up):
./dist/bin/linear.js --cwd $TMP --json project create --name "SEC05 Verify Temp" --team NIN --summary … --priority low   # 0
./dist/bin/linear.js --cwd $TMP --json project get|list|issues d2209ad98395                                # 0/0/0
./dist/bin/linear.js --cwd $TMP --json milestone create/list/get …                                        # 0/0/0
./dist/bin/linear.js --cwd $TMP --json project status d2209ad98395 started                                 # 0
./dist/bin/linear.js --cwd $TMP --json project update d2209ad98395 --summary …                             # 0
./dist/bin/linear.js --cwd $TMP --json update create|list|edit …                                          # 0/0/0
./dist/bin/linear.js --cwd $TMP --json project archive|list --include-archived|restore …                  # 0/0/0
./dist/bin/linear.js --cwd $TMP --json project delete d2209ad98395 --yes                                  # 0
./dist/bin/linear.js --cwd $TMP --json project get d2209ad98395                                           # 4 (gone)
./dist/bin/linear.js --cwd $TMP --json project list --limit 5                                             # 0, empty (state restored)
./dist/bin/linear.js --cwd $TMP auth logout --json                                                        # 0
rm -rf $TMP                                                                                               # removed
```

---

## 6. Verdict

Unit tests pass (2 files / 2 tests, exit 0), every required E2E check behaved as claimed (`project list --json` exit 0 with structured JSON, unknown references exit 4, `--dry-run` previews with zero mutation, delete-without-`--yes` exit 5, AUTH_REQUIRED exit 2), no secrets appeared in any output, and the shared `~/.config/linear-agent-mcp/client.json` is byte-for-byte unchanged (99 bytes, mtime 1795512864) with the temp login logged out and removed. Only two Low-severity defects (D1 missing client-side `--team` requirement enforcement, D2 trashed project still visible under `--include-archived`) and two informational notes (D3 no cycles in workspace, D4 dry-run resolves target first).

VERDICT: PASS

---
---

# Re-verification (post-fix)

- **Date:** 2026-11-25 (later same day; original findings above are retained as history)
- **Scope:** re-verify fixes for D1 and D2, plus the `normalizeError` mapping changes (`ForbiddenLinearError`/HTTP-200 "Not allowed to take action" → exit 3; "Entity not found: …" InvalidInput → exit 4)
- **Binary:** `./dist/bin/linear.js`, rebuilt 17:19 — confirmed `dist/` contains `Missing required option '--team <team>' …`, `Moved … to trash (Linear keeps it recoverable until purge)`, and the `trashed` field (source `src/modules/planning/commands.ts` lines 348–351, 591–594; `src/core/errors.ts` lines 113–122, 144–158)
- **Shared credential baseline:** `~/.config/linear-agent-mcp/client.json` → **99 bytes, mtime=1795512864, ctime=1795512864** (before)
- **Temp folder:** `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/sec05-reverify.GU4TcJ` (fresh `mktemp -d`, `--storage file`, `auth revoke` never run)

## R1. Unit tests

```
npx vitest run tests/sec-05-planning   →  Test Files 2 passed (2), Tests 2 passed (2), exit 0
npx vitest run (full suite)            →  Test Files 13 passed (13), Tests 26 passed (26), exit 0
```

- The D1 regression test is present in `tests/sec-05-planning/projects-milestones.test.ts` lines 136–148: `project create --name "No Team"` must exit `VALIDATION_ERROR`, stderr message must contain `--team`, and `createdProjInput` must remain unchanged (no second create happened).
- Note on the claimed "26 tests": `npx vitest run tests/sec-05-planning` reports **2 test cases** (32 `expect` assertions across the two files — 22 + 10). The **26-test total matches the whole suite** (`npx vitest run`: 13 files / 26 tests), which also passes. No failure either way; the discrepancy is in what "suite total" refers to, not in test results.

## R2. D1 — `project create` without `--team`

| Command | Exit | Observed |
|---|---|---|
| `--cwd $TMP --json project create --name "No Team Project"` (authenticated folder) | **5** | `VALIDATION_ERROR` "Missing required option '--team <team>' for 'linear project create'." |
| `--cwd $TMP project create --name "No Team Project"` (human mode) | **5** | `Error [VALIDATION_ERROR]: Missing required option '--team <team>' for 'linear project create'.` |
| **Unauthenticated** folder: `--json project create --name X` (no `--team`) | **5** | Same missing-`--team` message — **not** `AUTH_REQUIRED` (2) |
| Unauthenticated folder: `--json project list` (control) | **2** | `AUTH_REQUIRED` as before |

**No-network proof:** the missing-`--team` check sits at `src/modules/planning/commands.ts:349`, *before* `openVerifiedSession(ctx)` at line 360. Empirically confirmed: in a folder with no credentials the command still fails with the D1 message (exit 5) instead of `AUTH_REQUIRED` (exit 2), i.e. it errors before any session/token/network activity. **D1 fixed and verified.**

## R3. D2 — delete wording and `trashed` field (real write, cleaned up)

Created `SEC05 Reverify Temp` (slug `79f5d35872d5`, id `f1212859-…`), then:

| Command | Exit | Observed |
|---|---|---|
| `--json project delete 79f5d35872d5 --yes` | **0** | `{"id":…,"slugId":"79f5d35872d5","deleted":true,` **`"trashed":true`** `}` — `trashed` present alongside `deleted` |
| human mode: `project delete 784a10c25418 --yes` (second temp project `SEC05 Reverify Temp 2`) | **0** | `Moved project 784a10c25418 to trash (Linear keeps it recoverable until purge)` — new truthful wording |
| `--json project get 79f5d35872d5` (after delete) | **4** | `NOT_FOUND` (normal reads hide it, unchanged) |
| `--json project list --limit 5` (final state) | **0** | `data: []` — workspace back to its original state |

Help text also updated: `project delete` description now reads "Move a project to trash (requires --yes; recoverable until Linear purges it)" (`src/modules/planning/commands.ts:579`; equivalent wording for `issue delete` at `src/modules/issues/commands.js:678`). Server-side trash semantics unchanged (as stated), but the CLI now labels the outcome truthfully. **D2 addressed and verified.**

## R4. Spot-checks of earlier exit-code observations (all unchanged)

| Command | Exit | Result |
|---|---|---|
| `--json project get NO-SUCH-PROJECT-XYZ` | 4 | NOT_FOUND |
| `--json project delete NO-SUCH-PROJECT-XYZ --non-interactive` (no `--yes`) | 5 | VALIDATION_ERROR, fails before resolving |
| `--json cycle current --team NIN` | 4 | NOT_FOUND "Team has no active current cycle." (D3 still applies: workspace has no cycles) |
| `--json cycle list --team NIN --limit 3` | 0 | `data: []` |
| `--json update create --project NOPE --health banana --body test` | 5 | VALIDATION_ERROR "Invalid --health 'banana' …" |
| `--json project list --limit 3` | 0 | structured JSON, `data: []` |
| `--json milestone list --project NO-SUCH-PROJECT-XYZ` | 4 | NOT_FOUND |
| `--json cycle issues NOPE --team NIN` | 4 | NOT_FOUND |
| `--json --dry-run project create --name … --team NIN --summary …` | 0 | preview with resolved `teamIds`; immediate `project list` still `[]` → **no mutation** (dry-run behavior unchanged) |

Exit codes observed this round: **0, 2, 4, 5** — all identical to the original run; no previously-correct code regressed, and no undocumented code appeared. The `normalizeError` changes (permission denials → 3, `Entity not found` InvalidInput → 4) were source-verified (`src/core/errors.ts:113–122, 144–158`); neither scenario is reachable in this workspace (the app actor has full access to NineAI and no dangling-reference mutation was attempted), so **exit 3 remains unexercised by execution** — mapping code reviewed only.

## R5. Hygiene

- Secret scan over captured outputs (`lin_api_*`, `lin_oauth_*`, `*_token`, `Bearer …`): **NO SECRETS FOUND**.
- `~/.config/linear-agent-mcp/client.json` after all runs: **99 bytes, mtime=1795512864, ctime=1795512864 — identical to baseline.** `auth revoke` never run.
- `auth logout --json` → exit 0 (`loggedOut:true`); temp folder removed (verified gone); no `sec05*` temp files left.
- **Writes this round:** projects `SEC05 Reverify Temp` (slug `79f5d35872d5`) and `SEC05 Reverify Temp 2` (slug `784a10c25418`) — both created, then removed via `project delete --yes` (trash), verified `NOT_FOUND` / empty `project list` afterwards. Nothing else modified; only this report file was written.

## R6. Defect status after re-verification

| ID | Status |
|---|---|
| D1 — `--team` not enforced client-side | **FIXED & verified** (exit 5, exact claimed message, fails before session/network) |
| D2 — delete labeling | **ADDRESSED & verified** (`trashed: true` in JSON, new human wording, help text updated); underlying `--include-archived` visibility is Linear server trash behavior and intentionally unchanged |
| D3 — no cycles in workspace | Still applies (informational; `cycle current` → exit 4, happy path untestable here) |
| D4 — dry-run resolves target first | Unchanged (informational) |
| New: `normalizeError` exit 3 / exit 4 remap | Source-verified; not reachable by execution in this workspace (documented, not a defect) |

No new defects found this round.

## R7. Re-verification verdict

The `--team` regression test exists and the full suite passes (26/26 whole-suite tests; 2/2 in `tests/sec-05-planning`), D1 now fails fast client-side with exit 5 before any session/network call, D2 delete output truthfully reports trash semantics in both JSON (`trashed: true`) and human wording, all previously observed exit codes (0/2/4/5) and dry-run no-mutation behavior are unchanged, no secrets leaked, and the shared `~/.config/linear-agent-mcp/client.json` is byte-identical (99 bytes, mtime=1795512864) with the temp login logged out and removed.

VERDICT: PASS
