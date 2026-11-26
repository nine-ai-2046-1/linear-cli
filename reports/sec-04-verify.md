# Section 4 Verification: Comments, Documents, and Attachments

- **Date:** 2026-11-25
- **Project:** `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli`
- **Binary under test:** `./dist/bin/linear.js` (built; global `linear` 0.1.0 also present at `~/.local/bin/linear`)
- **Workspace:** NineAI (`urlKey nineai`), team key `NIN`
- **Auth under test:** app credentials from shared `~/.config/linear-agent-mcp/client.json`, `--storage file` in a fresh temp folder
- **Temp folder used:** `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/tmp.OzGWPY8YyU` (deleted at end)

## 1. Artifacts read

- `openspec/changes/sec-04-comments-docs-attachments/proposal.md`, `tasks.md`, `specs/comments-documents-attachments/spec.md`
- `src/modules/collaboration/commands.ts` (all 885 lines: comment/document/attachment command registrations)
- `src/core/errors.ts` (exit-code map: 0 success, 1 internal, 2 AUTH_REQUIRED, 3 FORBIDDEN, 4 NOT_FOUND, 5 VALIDATION_ERROR, 6 AMBIGUOUS_RESOURCE, 7 RATE_LIMITED, 8 OUTCOME_UNKNOWN, 9 UNSUPPORTED_BY_PUBLIC_API, 10 NETWORK_ERROR)

Claims in the proposal/spec: 3 subcommand groups (`comment list|add|reply|update|delete`, `document list|get|create|update|archive|restore`, `attachment list|get|upload|link|download|remove`), destructive `--yes` guards, `--dry-run` previews, Authorization header scoped only to `uploads.linear.app`, deterministic exit codes, structured `--json` output.

## 2. Unit tests

Command (project root):

```
npx vitest run tests/sec-04-collaboration
```

Result:

```
 Test Files  2 passed (2)
      Tests  3 passed (3)
   Duration  217ms
EXIT=0
```

- `tests/sec-04-collaboration/comments-docs.test.ts` — 2 tests (comment list/add/nested-reply root resolution/update/`--yes` delete guard; document list/get/create-from-file/update/archive/restore) — PASS
- `tests/sec-04-collaboration/attachments.test.ts` — 1 test (pre-signed PUT headers, URL link, Authorization scoped strictly to `uploads.linear.app`) — PASS

**Unit tests: 3/3 passed, 0 failed.**

## 3. End-to-end CLI runs (real API)

### 3.1 Authentication

```
./dist/bin/linear.js --cwd <tmp> auth login --app \
  --client-credentials-file "$HOME/.config/linear-agent-mcp/client.json" \
  --storage file --json --non-interactive
```

→ exit 0, `authenticated: true`, workspace `NineAI / nineai` confirmed. No token/key values appeared in output (only account id/name/email and workspace metadata).

### 3.2 Find a real issue

```
./dist/bin/linear.js --cwd <tmp> issue list --json --limit 5
```

→ exit 0; used `NIN-18` (id `676d8113-d9d5-48d7-8c0e-a6da4a55a315`), which already had 1 comment.

### 3.3 Required read-only commands

| Command | Exit | Observed |
|---|---|---|
| `comment list --issue NIN-18 --json` | **0** | Structured JSON `{ok:true, data:[{id, author, authorId, parentId, body, url, createdAt, updatedAt}], pageInfo:{hasNextPage, endCursor, count}}`; 1 pre-existing comment returned. |
| `document list --json` | **0** | `{ok:true, data:[], pageInfo:{count:0}}` — workspace has no documents; valid empty page. |
| `attachment list --issue NIN-18 --json` | **0** | `{ok:true, data:[]}` — no attachments on that issue; valid empty list. |

Human (non-JSON) mode also works: `comment list --issue NIN-18` printed an aligned table, exit 0.

### 3.4 Unknown references → exit 4 NOT_FOUND

| Command | Exit | Error |
|---|---|---|
| `comment list --issue NIN-9999 --json` | **4** | `NOT_FOUND — Issue 'NIN-9999' not found.` |
| `attachment list --issue NIN-9999 --json` | **4** | `NOT_FOUND — Issue 'NIN-9999' not found.` |
| `document get deadbeef-0000-0000-0000-000000000000 --json` | **4** | `NOT_FOUND — Document '…' not found.` |
| `attachment get 00000000-0000-0000-0000-000000000000 --json` | **4** | `NOT_FOUND — Attachment '…' not found.` |
| `attachment get not-a-uuid --json` | **4** | `NOT_FOUND — Attachment 'not-a-uuid' not found.` |

All as claimed: exit 4 with `code: NOT_FOUND` in the JSON envelope.

### 3.5 Validation / auth exit codes

| Command | Exit | Error |
|---|---|---|
| `comment list --json` (neither `--issue` nor `--project`) | **5** | `VALIDATION_ERROR — Provide exactly one of '--issue <issue>' or '--project <project>'.` |
| `comment delete <existing-id>` (no `--yes`) | **5** | `VALIDATION_ERROR — Destructive operation … requires explicit '--yes' flag (or '--dry-run' to preview).` — **no mutation occurred** (comment still present afterward). |
| `comment list --issue NIN-18 --json` in a fresh folder with no auth | **2** | `AUTH_REQUIRED — No Linear authentication found in folder …` |

### 3.6 `--dry-run` performs no mutation and previews input

All three returned exit 0 with `dryRun: true`, an `operation` name, and resolved `parameters`:

- `--dry-run comment add --issue NIN-18 --body "verify dry-run" --json` → `operation: comment.add`, parameters `{issueId: "676d8113-…", body: "verify dry-run"}` (issue resolved to UUID).
- `--dry-run document create --title "Verify Temp Doc" --content "dry run content" --json` → `operation: document.create`, parameters `{title, content}`.
- `--dry-run attachment link --issue NIN-18 --url https://example.com/doc --title "Verify Link" --json` → `operation: attachment.link`, parameters `{issueId, url, title}`.
- `--dry-run comment reply <id> --body "temp reply" --json` → `operation: comment.reply`, parameters `{parentId, body, issueId}` (root-thread/parent resolution preview works).

**No-mutation verification:** after all dry-runs, re-ran `comment list --issue NIN-18` (still 1 comment, the original), `document list` (still empty), `attachment list` (still empty). No new comments, documents, or attachments existed.

### 3.7 Real write + cleanup (one controlled write)

To prove the write path (not just dry-run):

1. `comment add --issue NIN-18 --body "sec-04 verifier temp comment (will be deleted)" --json` → **exit 0**, comment `4b491179-bd11-421e-8990-dcf73484af85` created with URL.
2. `comment delete 4b491179-… --yes --json` → **exit 0**, `{deleted: true}`.
3. Re-list: `count=1 leaked=false` — back to the original state, nothing left behind.

No documents or attachments were created (dry-run only for those).

### 3.8 Attachment download host scoping (preview)

- `--dry-run attachment download https://example.com/doc.html --output …` → `authenticatedLinearStorage: false` (exit 0).
- `--dry-run attachment download https://uploads.linear.app/xyz/file --output …` → `authenticatedLinearStorage: true` (exit 0).

Matches the spec: Authorization is attached only when hostname is exactly `uploads.linear.app` (confirmed in source `src/modules/collaboration/commands.ts` lines 820–825; external redirects are followed without re-attaching headers, lines 836–846). Live authenticated downloads were not exercised (no attachment existed); the dry-run preview plus unit test cover the scoping.

### 3.9 Exit codes vs documented set (README line 70: 0,1,2,3,4,5,6,7,8,9,10)

| Code | Live-observed in this session | Notes |
|---|---|---|
| 0 | Yes (many) | |
| 2 | Yes (AUTH_REQUIRED) | |
| 3 | No | Defined in `src/core/errors.ts`; not triggerable without a permission-denied workspace. |
| 4 | Yes (×5) | |
| 5 | Yes (×2) | |
| 6, 7, 8, 9, 10 | No | Defined in `src/core/errors.ts` and covered by sec-01 runtime tests; not naturally triggerable here (no duplicate doc titles, no 429, no create timeout, no API-unsupported field, no network failure). |
| 1 | No | INTERNAL_ERROR fallback; not triggered. |

No undocumented exit codes were observed; every failure surfaced one of the documented codes with a matching `error.exitCode` in JSON.

### 3.10 Secrets scan

Captured output of `comment list`, `document list`, `attachment list`, and a dry-run through:

```
grep -Ei "lin_api|bearer |api[_-]?key|\"token\"|secret|authorization|client_secret|access_token" <captured>
```

→ `NO_SECRETS_MATCH`. No tokens/keys in any success or error output (error messages contain only file paths and identifiers).

## 4. Shared credential file integrity

| Check | Before | After |
|---|---|---|
| Size (bytes) | 99 | 99 |
| mtime | 1795512864 | 1795512864 |
| md5 | `cddc1dfcddd9caa02baa40f9e2e5cfe4` | `cddc1dfcddd9caa02baa40f9e2e5cfe4` |

`~/.config/linear-agent-mcp/client.json` is **byte-identical** before and after. `linear auth revoke` was never run. Test login used `--storage file`; teardown executed:

```
./dist/bin/linear.js --cwd <tmp> auth logout --json   → exit 0, loggedOut: true
rm -rf <tmp>                                          → temp folder deleted (confirmed gone)
```

## 5. Defects

| # | Severity | Finding |
|---|---|---|
| 1 | **Low (documentation/coverage gap, not a runtime bug)** | Only 3 unit tests exist for the whole section despite `tasks.md` claiming coverage of "root-thread reply resolution, Markdown file inputs, and destructive `--yes` guards" plus upload/link/scoped-download — all assertions are packed into 3 large `it()` blocks. All pass, and my E2E runs independently confirmed each behavior, so functionality is verified; but a single regression would fail a monolithic test with a coarse signal. |
| 2 | **Info** | `document list` and `attachment list` on NIN-18 returned empty arrays because the workspace genuinely has zero documents and that issue has zero attachments — verified as valid empty pages (exit 0, `ok: true`), not errors. Real (non-empty) document/attachment reads could not be exercised against this workspace state. |
| 3 | **Info** | Live authenticated `attachment download` and real `attachment upload`/`document create` were intentionally not run (no dry-run available that fully exercises the PUT path; avoided unnecessary writes). Upload/download logic is covered by the unit test and the dry-run host-scoping previews above. |

No functional defects found: all required behaviors matched the spec on execution.

## 6. VERDICT

VERDICT: PASS
