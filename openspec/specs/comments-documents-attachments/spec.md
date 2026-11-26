# comments-documents-attachments Specification

## Purpose

Provides CLI commands for issue/project discussion comments, native Linear Markdown documents, and issue file/link attachments with secure cloud-storage authentication boundaries.

## Requirements

### Requirement: Issue and Project Comment Threads and Replies
The CLI SHALL provide `linear comment list` (`--issue` or `--project`), `linear comment add` (`--body` or `--body-file`), `linear comment reply <comment>`, `linear comment update <comment>`, and `linear comment delete <comment> --yes`.

#### Scenario: Reply to a nested comment resolves root thread and parent issue
- **WHEN** `linear comment reply cmt-child --body "Fixed in PR" --json` runs where `cmt-child` has `parent.id = cmt-root` on `NIN-11`
- **THEN** the CLI calls `createComment` with `parentId: "cmt-root"` and `issueId` of `NIN-11`

### Requirement: Linear Markdown Document Management
The CLI SHALL provide `linear document list` (supporting `--query`, `--project`, `--issue`, `--include-archived`), `linear document get <doc>`, `linear document create`, `linear document update <doc>`, `linear document archive <doc>`, and `linear document restore <doc>`.

#### Scenario: Create and update document from Markdown files
- **WHEN** `linear document create --title "Setup Spec" --content-file doc.md --project P-1 --json` executes
- **THEN** the CLI creates the document linked to project `P-1` and returns its `id`, `slugId`, `title`, and `url`

### Requirement: Pre-Signed File Upload, URL Linking, and Scoped Attachment Download
The CLI SHALL provide `linear attachment list --issue <issue>`, `linear attachment get <id>`, `linear attachment upload --issue <issue> --file <path>`, `linear attachment link --issue <issue> --url <url> --title <title>`, `linear attachment download <id-or-url> --output <path>`, and `linear attachment remove <id> --yes`. Downloads MUST send Linear `Authorization` headers only to `uploads.linear.app`.

#### Scenario: Upload file via fileUpload pre-signed PUT and link attachment
- **WHEN** `linear attachment upload --issue NIN-11 --file ./log.txt --json` executes
- **THEN** the CLI requests `fileUpload`, PUTs the raw file bytes with all returned signed headers to `uploadUrl`, and calls `createAttachment` with the returned `assetUrl`

#### Scenario: External attachment download strips Linear Authorization header
- **WHEN** `linear attachment download att-ext --output ./out.html --json` runs for an attachment pointing to `https://example.com/doc`
- **THEN** the CLI fetches `https://example.com/doc` without attaching the Linear `Authorization` header
