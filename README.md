# `@nineai/linear-cli` (`linear`)

繁體中文（廣東話）：[`README-zh.md`](README-zh.md)

A modular, agent-first Linear CLI built on the official [`@linear/sdk`](https://linear.app/developers/sdk) (`v104.0.0`). Install once globally (`linear`), while keeping authentication **strictly isolated per working directory** (`<cwd>/.linear/auth.json`) with zero parent-directory traversal and zero global credential fallback.

## Global Installation

```sh
cd linear-cli
npm install
sh ./scripts/install-global.sh
linear --version
```

## Per-Folder Authentication Isolation

When `linear` runs in `folder-a`, it reads **only** `folder-a/.linear/auth.json` (or `--cwd <folder>`). Secrets are stored in macOS Keychain (`ai.nineai.linear-cli`) by default, or in `0600` `.linear/credentials.json` when `--storage file` is passed.

```sh
# 1. Personal API key (recommended for quick per-folder personal user setup)
printf '%s\n' "$MY_PERSONAL_LINEAR_KEY" | linear auth login --api-key --api-key-stdin --json --non-interactive

# 2. Personal OAuth 2.0 PKCE browser login
linear auth login --client-id YOUR_OAUTH_CLIENT_ID

# 3. OAuth App client_credentials (unattended app actor)
linear auth login --app --client-credentials-file /path/to/client.json --json --non-interactive

# Inspect, verify, switch account, logout, or revoke
linear auth status --json
linear auth whoami --json
linear auth reauth --api-key --api-key-stdin
linear auth logout --json
linear auth revoke --json
```

## Command Overview (Sections 1–7)

| Group | Commands |
|---|---|
| `auth` | `login`, `status`, `whoami`, `reauth`, `logout`, `revoke` |
| `workspace` / `me` | `workspace info`, `me` |
| `user` | `list`, `get <user\|me>` |
| `team` | `list`, `get <team>`, `members <team>` |
| `status` | `list --team <team>` |
| `template` | `list`, `get <template>` |
| `issue` | `list`, `mine`, `search <q>`, `get <id>`, `create`, `update <id>`, `status <id> <state>`, `assign <id> <user>`, `unassign <id>`, `label add/remove`, `priority <id> <p>`, `project set <id> <proj\|none>`, `archive <id>`, `restore <id>`, `delete <id> --yes`, `subscribe <id>`, `unsubscribe <id>`, `share <id> <user>`, `unshare <id> <user>`, `children <id>`, `parent set <id> <parent\|none>`, `relation list/add/remove` |
| `comment` | `list`, `add`, `reply <commentId>`, `update <commentId>`, `delete <commentId> --yes` |
| `document` | `list`, `get <doc>`, `create`, `update <doc>`, `archive <doc>`, `restore <doc>` |
| `attachment` | `list --issue <id>`, `get <id>`, `upload --issue <id> --file <path>`, `link --issue <id> --url <url> --title <t>`, `download <idOrUrl> --output <path>`, `remove <id> --yes` |
| `project` | `list`, `get <proj>`, `issues <proj>`, `create`, `update <proj>`, `status <proj> <st>`, `archive <proj>`, `restore <proj>`, `delete <proj> --yes` |
| `milestone` | `list --project <p>`, `get <ms>`, `create --project <p>`, `update <ms>` |
| `cycle` | `list --team <t>`, `current --team <t>`, `issues <current\|next\|previous\|num\|uuid> [--team <t>]` |
| `update` | `list --project <p>`, `create --project <p>`, `edit <updateId>` |
| `label` | `list`, `create`, `update <lbl>`, `archive <lbl>`, `restore <lbl>` |
| `view` | `list`, `get <view>` |
| `inbox` | `list [--unread]`, `read <id>`, `unread <id>`, `snooze <id> --until <time\|none>` (uses Linear's grouped Inbox view; `--unread` is filtered server-side across all pages) |
| `release` / `release-note` | `release pipeline list`, `release list/get/create/update`, `release-note list/get/create` |
| `review` | `list`, `get <prUrlOrAttachmentId>`, `link --issue <id> --url <prUrl>`, `comment/approve/request-changes/merge` (enforces Linear public GraphQL API capability boundary with exit code `9`) |
| `api` | `query` (AST-verified read-only), `mutation --allow-mutation` |

## Global Automation Flags & Exit Codes

- `--json`: Deterministic `{ "ok": true, "data": ... }` on stdout; structured errors on stderr.
- `--non-interactive`: Never waits on stdin prompts.
- `--dry-run`: Resolves human references and previews mutation inputs without mutating Linear.
- `--cwd <dir>`: Target a specific project folder's `.linear/auth.json`.
- `--expect-workspace <ws>` / `--expect-user <user>`: Abort with exit `3` (`FORBIDDEN`) if folder identity mismatches.
- Exit codes: `0` success, `1` internal, `2` `AUTH_REQUIRED`, `3` `FORBIDDEN`, `4` `NOT_FOUND`, `5` `VALIDATION_ERROR`, `6` `AMBIGUOUS_RESOURCE`, `7` `RATE_LIMITED`, `8` `OUTCOME_UNKNOWN` (create timeout), `9` `UNSUPPORTED_BY_PUBLIC_API`, `10` `NETWORK_ERROR`.
