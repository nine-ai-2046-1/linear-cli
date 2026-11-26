# Proposal

## Why

Agents and users maintaining Linear workspaces need commands to create/update/retire/restore issue labels, inspect saved Custom Views (`linear view`), and triage personal or agent Inbox notifications (`linear inbox`) without switching to the web UI.

## What Changes

- Implement `src/modules/metadata/commands.ts`:
  - Labels (extending `linear label` from Section 2): `linear label create`, `linear label update <label>`, `linear label archive <label>` (`issueLabelRetire`, or `--delete --yes` for permanent delete), `linear label restore <label>` (`issueLabelRestore`)
  - Saved Custom Views: `linear view list` (`--query`, `--team`, `--shared`, `--limit`, `--cursor`) and `linear view get <view>`
  - Inbox Notifications: `linear inbox list` (`--unread`, `--limit`, `--cursor`), `linear inbox read <notification>`, `linear inbox unread <notification>`, `linear inbox snooze <notification> --until <iso|duration|none>`

## Capabilities

### New Capabilities
- `labels-views-inbox`: Issue label creation, updates, retirement, and restoration; saved custom view discovery; and inbox notification listing, read/unread state updates, and snoozing.

### Modified Capabilities

## Impact

- Adds `src/modules/metadata/commands.ts` and `tests/sec-06-metadata/*`, and registers metadata commands in `src/cli/app.ts`.
