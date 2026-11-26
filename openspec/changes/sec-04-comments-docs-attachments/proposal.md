# Proposal

## Why

Daily engineering collaboration in Linear relies on issue/project comment threads, native Markdown documents, and file or URL attachments. Agents investigating bugs, posting standup updates, writing specs, or uploading logs/screenshots need direct CLI commands for comments, documents, and secure Linear cloud storage uploads/downloads.

## What Changes

- Implement `src/modules/collaboration/commands.ts`:
  - Comments: `linear comment list` (`--issue` or `--project`), `linear comment add` (`--issue` or `--project`, `--body` / `--body-file`), `linear comment reply <comment>` (auto-resolving root thread `parentId` and parent issue/project), `linear comment update <comment>`, `linear comment delete <comment> --yes`
  - Documents: `linear document list` (`--query`, `--project`, `--issue`, `--include-archived`), `linear document get <document>`, `linear document create` (`--title`, `--content` / `--content-file`, `--project`, `--issue`), `linear document update <document>`, `linear document archive <document>`, `linear document restore <document>`
  - Attachments: `linear attachment list --issue <issue>`, `linear attachment get <attachment>`, `linear attachment upload --issue <issue> --file <path>`, `linear attachment link --issue <issue> --url <url> --title <title>`, `linear attachment download <attachment-or-url> --output <path>` (sending auth headers ONLY to `uploads.linear.app`), `linear attachment remove <attachment> --yes`

## Capabilities

### New Capabilities
- `comments-documents-attachments`: Issue and project comment threads/replies, Linear Markdown documents CRUD/archive/restore, and pre-signed file attachment uploads, external links, and host-scoped authenticated downloads.

### Modified Capabilities

## Impact

- Adds `src/modules/collaboration/commands.ts` and `tests/sec-04-collaboration/*`, and registers `comment`, `document`, and `attachment` commands in `src/cli/app.ts`.
