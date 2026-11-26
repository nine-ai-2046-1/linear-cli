# Section 7 Verification Report — Releases, Reviews, Raw API, and Global Installation

- **Date:** 2026-11-25
- **Verifier:** independent subagent (no prior context; verified by execution only)
- **Project root:** `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli`
- **Binary under test:** `./dist/bin/linear.js` (global `linear` → `~/.local/bin/linear` → symlink to the same file)
- **Workspace under test:** NineAI (`urlKey nineai`), team key `NIN` — confirmed at runtime (see T3 below)
- **Shared credentials file:** `~/.config/linear-agent-mcp/client.json` — **never revoked, never modified** (mtime/size identical before and after)

---

## 1. What was claimed (from `openspec/changes/sec-07-releases-reviews-raw-api/`)

- **proposal.md:** `release pipeline list|list|get|create|update`, `release-note list|get|create`, `review list|get|link` plus `review comment|approve|request-changes|merge` returning `UNSUPPORTED_BY_PUBLIC_API` (exit 9) when Linear's public GraphQL schema lacks internal Diff mutations; AST-guarded `api query` (read-only, mutations rejected with exit 5) and `api mutation --allow-mutation`; global installer + docs.
- **spec delta (`specs/releases-reviews-raw-graphql/spec.md`):**
  - Scenario: `api query` with a mutation document aborts **before any network call** with exit code `5`.
  - Scenario: `review approve <url>` against the public API exits `9` rather than faking approval.
  - Scenario: `api query` executes via `LinearGraphQLClient.rawRequest` and returns `data`.
- **tasks.md:** 1.1 and 2.1 marked `[x]` (unit tests pass, global install, live `api query`).

Source read: `src/modules/advanced/commands.ts` (797 lines), `src/cli/app.ts` (130 lines, incl. `isVersionRequest` which deliberately does **not** register root `--version` as a commander option), `src/core/errors.ts` (`ExitCode` map), `src/core/client.ts` (session/auth ordering), `tests/sec-07-advanced/advanced-cli.test.ts` (228 lines).

---

## 2. Unit tests (exact commands and results)

Command (section tests):
```
cd /Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli
npx vitest run tests/sec-07-advanced
```
Result: **Test Files 1 passed (1), Tests 1 passed (1)**, exit 0.

Command (full suite):
```
npx vitest run
```
Result: **Test Files 13 passed (13), Tests 24 passed (24)**, exit 0.

Also verified `dist/` was built after the newest `src/*.ts` (no source file newer than `dist/bin/linear.js`), so the binary tested matches current source.

---

## 3. End-to-end CLI runs (real network, fresh temp folders)

Temp folders used (all under `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/`, all deleted at the end):
- `sec07-auth-xbKXzZ` (authenticated)
- `sec07-auth2-Yvcb4N` (authenticated, second session)
- `sec07-unauth-FB6gxt` (never authenticated)
- `sec07-out-RWh4yf` (captured stdout/stderr logs; deleted after scanning)

`$TMP` below is one of the authenticated folders. **No `auth revoke` was ever run.** All test logins used `--storage file`.

### T1. Auth login / logout (and workspace confirmation)
```
./dist/bin/linear.js --cwd $TMP auth login --app --client-credentials-file "$HOME/.config/linear-agent-mcp/client.json" --storage file --json --non-interactive
```
→ exit **0**; stdout JSON: `"authenticated": true`, `"authType": "app"`, `"storage": "file"`, workspace `"name": "NineAI"`, `"urlKey": "nineai"`, `"url": "https://linear.app/nineai"`.

```
./dist/bin/linear.js --cwd $TMP auth logout --json
```
→ exit **0**, `"loggedOut": true`. (Run after each authenticated session.)

### T2. Read-only list commands return structured JSON, exit 0
```
./dist/bin/linear.js --cwd $TMP release pipeline list --json   → exit 0
./dist/bin/linear.js --cwd $TMP release list --json            → exit 0
./dist/bin/linear.js --cwd $TMP release-note list --json       → exit 0
./dist/bin/linear.js --cwd $TMP review list --json             → exit 0
```
All four printed the standard envelope on stdout, e.g.:
```json
{ "ok": true, "data": [], "pageInfo": { "hasNextPage": false, "endCursor": null, "count": 0 } }
```
(`review list` → `{ "ok": true, "data": [] }`.) Note: the NineAI workspace currently has **zero** release pipelines, releases, release notes, and PR attachments, so `data` is empty — but the calls were real network reads and returned exit 0 with valid JSON.

### T3. Team/workspace confirmation
```
./dist/bin/linear.js --cwd $TMP team list --json
```
→ exit **0**; `data[0] = { "key": "NIN", "name": "NineAI", ... }` — confirms the NIN team in workspace NineAI.

### T4. `api query` performs a real network call and returns viewer data
```
./dist/bin/linear.js --cwd $TMP api query --query 'query { viewer { id name organization { name urlKey } } }' --json
```
→ exit **0**, stdout:
```json
{ "ok": true, "data": { "viewer": { "id": "aeed4513-8d63-407a-b35c-9ed566e1749e",
  "name": "Local Agent MCP", "organization": { "name": "NineAI", "urlKey": "nineai" } } } }
```
Real data only obtainable from the Linear API ⇒ genuine network round-trip via `rawRequest`.

### T5. Mutation document passed to `api query` → exit 5, no network call
```
./dist/bin/linear.js --cwd $TMP api query --query 'mutation { issueArchive(id: "1") { success } }' --json
```
→ exit **5**, stderr JSON:
```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "exitCode": 5,
  "message": "Rejected 'mutation' operation in 'linear api query'. Use 'linear api mutation --allow-mutation' for mutations." } }
```
**No-network evidence:** the same command was run in a folder with **no authentication at all** (`$TMP2`):
```
cd $TMP2 && linear api query --query 'mutation { issueArchive(id: "1") { success } }' --json
```
→ exit **5** (not 2 `AUTH_REQUIRED`). Since auth lookup and all network access happen only after AST validation (confirmed in source: `validateGraphQLOperations()` runs before `openVerifiedSession()` in the `api query` action), validation aborts before any auth/network step. The unit test additionally asserts `rawRequests` stays empty on this path.

Also: `linear api query --json` (no query at all) → exit **5** `"Provide a GraphQL query via '--query <gql>' or '--file <path>'."`.

### T6. `review approve <url>` → exit 9, no fake success
```
./dist/bin/linear.js --cwd $TMP review approve https://github.com/nineai/cli/pull/42 --json
```
→ exit **9**, stdout empty, stderr JSON:
```json
{ "ok": false, "error": { "code": "UNSUPPORTED_BY_PUBLIC_API", "exitCode": 9,
  "message": "Linear's public GraphQL API (@linear/sdk) does not expose internal Diffs 'approve' mutations. Use 'gh pr review'/'gh pr merge' for GitHub PRs or Linear's hosted MCP worker.",
  "details": { "operation": "review.approve", "target": "https://github.com/nineai/cli/pull/42" } } }
```
No success payload was fabricated. Related: `review get some-internal-diff-slug --json` → exit **9** with the truthful "public GraphQL API does not expose internal Diff slug" message.

### T7. Version and help
```
./dist/bin/linear.js --version   → stdout "0.1.0", exit 0
./dist/bin/linear.js --help      → full usage text, exit 0
linear --json --version          → stdout "0.1.0", exit 0
```

### T8. Global install works from an unrelated directory
```
cd / && linear --version   → "0.1.0", exit 0
cd / && linear --help      → full usage text, exit 0
```
`which linear` → `/Users/IMTCRS/.local/bin/linear` (symlink to the project's `dist/bin/linear.js`); `~/.local/bin` is on `PATH`. Help run from `/` (unrelated to the project) succeeded ⇒ global installation works.

### T9. Subcommand `--version` is NOT hijacked by the root version flag (the key claim)
Unauthenticated temp folder, cwd = `$TMP2`:
```
linear release create --pipeline x --name y --version 1.0.0 --json
```
→ exit **2**, stderr JSON `{"ok": false, "error": { "code": "AUTH_REQUIRED", "exitCode": 2, "message": "No Linear authentication found in folder '...' (expected .../.linear/auth.json). ..." }}`.
**stdout was empty** — the CLI printed `0.1.0` nowhere. It failed on auth, not by printing the CLI version. ✓

Supporting evidence:
```
linear release create --help   → exit 0, Options include "--version <version>   Version string (e.g. 1.0.0)"
```
Authenticated variant (proves `--version` reaches the action handler instead of short-circuiting):
```
./dist/bin/linear.js --cwd $TMP3 release create --pipeline prod --name y --version 1.0.0 --dry-run --json
```
→ exit **4** `NOT_FOUND` ("Release pipeline 'prod' not found." — the workspace has no pipelines), stdout empty, no version print. A `--dry-run` release create therefore exercised option parsing + pipeline resolution, but a *successful* dry-run preview could not be produced because the workspace has no release pipelines (see D2).

### T10. Other exit codes exercised
| Command | Exit | Code |
|---|---|---|
| `release pipeline list --json` / `release list --json` / `api query ... viewer` / `--version` / `--help` / `auth login` / `auth logout` | 0 | SUCCESS |
| `linear release create --pipeline x --name y --version 1.0.0 --json` (unauth) | 2 | AUTH_REQUIRED |
| `api mutation --query 'mutation {...}' --json` (no `--allow-mutation`) | 3 | FORBIDDEN — "Raw GraphQL mutations require '--allow-mutation' (or '--dry-run' to preview)." |
| `release get nosuchrelease-xyz-123 --json` | 4 | NOT_FOUND |
| `release create --pipeline prod ... --dry-run` (no such pipeline) | 4 | NOT_FOUND |
| `api query --query 'mutation {...}' --json` (authed **and** unauthed) | 5 | VALIDATION_ERROR |
| `api query --json` (missing query) | 5 | VALIDATION_ERROR |
| `release create --pipeline '' ...` (empty ref) | 5 | VALIDATION_ERROR |
| `review merge <url> --non-interactive --json` (no `--yes`) | 5 | VALIDATION_ERROR (confirmation precedes auth) |
| `linear --cwd <dir> --version` | 5 | VALIDATION_ERROR — see defect D1 |
| `review approve <url> --json` | 9 | UNSUPPORTED_BY_PUBLIC_API |
| `review get <internal-slug> --json` | 9 | UNSUPPORTED_BY_PUBLIC_API |

Exit codes **1, 6, 7, 8, 10** were not triggered in this run (INTERNAL_ERROR, AMBIGUOUS_RESOURCE, RATE_LIMITED, OUTCOME_UNKNOWN, NETWORK_ERROR are not reachable on demand without server-side fault injection). They are present and correctly mapped in `src/core/errors.ts` (`ExitCode` = 0,1,2,3,4,5,6,7,8,9,10), which matches the documented set {0,2,3,4,5,6,7,8,9,10} plus 1.

Safe write-path probes (no writes performed):
```
./dist/bin/linear.js --cwd $TMP3 api mutation --query 'mutation { issueArchive(id: "1") { success } }' --dry-run --json
```
→ exit **0**, stdout `{"ok": true, "dryRun": true, "operation": "api.mutation", "data": {...}}` — preview only, no mutation executed.
No real write commands (`release create/update`, `release-note create`, `review link`) were executed non-dry-run; nothing needed cleanup in Linear.

---

## 4. Secret / credential hygiene

- Scanned all 60 captured stdout/stderr files for the literal values of `client_id` and `client_secret` from `~/.config/linear-agent-mcp/client.json`, plus JWT-like (`eyJ...`), `lin_api_...`, and `Bearer <token>` patterns:
  **"NO SECRETS/TOKENS FOUND IN ANY OUTPUT".**
- `~/.config/linear-agent-mcp/client.json`: **before** `mtime=1795512864 size=99`; **after all runs** `mtime=1795512864 size=99` — unchanged. No `linear auth revoke` was ever executed.
- No `.linear/` folder was created inside the project (verified with `find`); all auth state lived in the temp folders.
- All temp folders (`sec07-auth-*`, `sec07-unauth-*`, `sec07-out-*`) deleted after the runs.

---

## 5. Defects found

**D1 — LOW: `linear --cwd <dir> --version` does not print the version.**
Observed: `linear --cwd /path/to/dir --version` → exit **5**, stderr `Error [VALIDATION_ERROR]: unknown option '--version'`.
Cause: `isVersionRequest()` in `src/cli/app.ts` only treats `--version`/`-V` as the CLI version when every preceding argv token starts with `-`; the `--cwd` *value* (a path) fails that check, so the flag falls through to commander, which has no root `--version` option registered. `linear --version` and `linear --json --version` both work (exit 0, prints `0.1.0`), and the subcommand case (`release create --version 1.0.0`) correctly works — which is the tradeoff the code comment documents. Impact: minor UX inconsistency for `linear --cwd <dir> --version` / `linear --expect-workspace X --version` style invocations. Not a violation of any Section 7 spec requirement.

**D2 — INFO (verification limitation, not a CLI defect):** the NineAI workspace has no release pipelines/releases/release-notes, so happy-path `release create`/`release-note create`/`release get` on real records could not be exercised end-to-end (and the CLI provides no pipeline-create command). Those paths were covered by the mocked unit test (`tests/sec-07-advanced/advanced-cli.test.ts`, passing) plus live `NOT_FOUND`/validation paths. No defect observed in the shipped code from these runs.

No MEDIUM or HIGH defects found. All claims in the Section 7 proposal/spec that were testable were confirmed by execution.

---

## 6. Final verdict

Every required check passed by real execution: structured-JSON list commands exit 0; `api query` makes a real network call returning viewer/workspace data; mutation documents passed to `api query` exit 5 before any auth/network step; `review approve` exits 9 with a truthful error and no fabricated success; `--version`/`--help` exit 0; the global `linear` binary works from an unrelated directory; `linear release create --pipeline x --name y --version 1.0.0 --json` in an unauthenticated folder fails with `AUTH_REQUIRED` exit 2 (not a version print); observed exit codes are a subset of the documented set and match the source mapping; no secrets appeared in any output; the shared MCP credential file is byte-identical (mtime/size unchanged); all temp logins were logged out and temp folders deleted. One low-severity edge-case defect (D1) was found and documented above.

VERDICT: PASS

---

# Re-verification (post-fix) — 2026-11-25 (~17:21)

The LOW defect **D1** from the original report above is re-tested here by execution. Original findings are kept unchanged as history.

## What changed

`src/cli/app.ts` — `isVersionRequest()` now skips value-taking global flags when deciding whether `--version`/`-V` is a standalone CLI version request: `GLOBAL_VALUE_FLAGS = {"--cwd", "--expect-workspace", "--expect-user"}`; each arg before the flag is consumed as a value when it follows one of those (including `=`-form detection), so `linear --cwd <dir> --version` no longer falls through to commander as an unknown option. `--version` is still intentionally not registered as a program option, so subcommand options named `--version` are not hijacked. Confirmed the fix is present in both `src/cli/app.ts` and the built `dist/cli/app.js` (and no `src/*.ts` is newer than `dist/bin/linear.js`).

## Unit tests (exact commands and results)

```
npx vitest run tests/sec-07-advanced   → Test Files 1 passed (1), Tests 2 passed (2), exit 0
npx vitest run                          → Test Files 13 passed (13), Tests 26 passed (26), exit 0
```
Full suite fully green; total is now 26 tests (was 24), i.e. the new regression test is included.

## E2E re-tests (real binary, fresh temp folders)

`$TMP` = fresh unauthenticated temp folder `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec07re-unauth-uhNB33` (no auth performed this round — no login/logout needed).

| # | Command (cwd) | stdout | Exit |
|---|---|---|---|
| 1 | `./dist/bin/linear.js --version` (project dir) | `0.1.0` | 0 |
| 2 | `./dist/bin/linear.js -V` | `0.1.0` | 0 |
| 3 | `./dist/bin/linear.js --json --version` | `0.1.0` | 0 |
| 4 | `./dist/bin/linear.js --cwd $TMP --version` ← **the previously failing case (old D1)** | `0.1.0` | **0** |
| 5 | `./dist/bin/linear.js --expect-workspace nineai --version` | `0.1.0` | 0 |
| 6 | `./dist/bin/linear.js --cwd $TMP --json --version` | `0.1.0` | 0 |
| 7 | `linear --version` (cwd `/`, unrelated dir, global install) | `0.1.0` | 0 |
| 8 | `linear -V` (cwd `/`) | `0.1.0` | 0 |

Previously-failing invocation #4 now prints the version and exits 0 — **D1 is fixed.**

### Subcommand `--version` still not hijacked (regression check)

```
cwd=$TMP: linear release create --pipeline x --name y --version 1.0.0 --json
```
→ stdout **empty**, stderr JSON `{"ok": false, "error": { "code": "AUTH_REQUIRED", "exitCode": 2, ... }}`, **exit 2** — NOT the version string. ✓

```
cwd=$TMP: linear --cwd $TMP release create --pipeline x --name y --version 1.0.0 --json
```
→ stdout **empty**, same `AUTH_REQUIRED` exit **2** — the value-taking global flag before the subcommand does not confuse the detection either. ✓

```
./dist/bin/linear.js release create --help
```
→ exit 0; Options still include `--version <version>   Version string (e.g. 1.0.0)`. ✓

## Hygiene (rules unchanged)

- **No `auth revoke` executed**; no authentication performed at all in this round.
- `~/.config/linear-agent-mcp/client.json`: **before** `mtime=1795512864 size=99`; **after** `mtime=1795512864 size=99` — identical.
- Scanned all 22 captured stdout/stderr files for `client_id`/`client_secret` values, `eyJ…`, `lin_api_`, `Bearer <token>`: **NO SECRETS/TOKENS FOUND IN ANY OUTPUT**.
- No `.linear/` folder created in the project; both temp folders (`sec07re-out-*`, `sec07re-unauth-*`) deleted.

## Defect status

- **D1 (LOW, `linear --cwd <dir> --version` → exit 5): RESOLVED** — verified by execution as shown above (row 4), with no regression in the subcommand `--version` behavior or global `--version` from an unrelated directory.
- D2 (INFO, workspace has no release pipelines — verification limitation) still stands as an observation, unchanged and not a CLI defect.

All original Section 7 checks remain green; the fix introduces no new defects observed in this round.

VERDICT: PASS
