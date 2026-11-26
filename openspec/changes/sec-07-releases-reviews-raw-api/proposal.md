# Proposal

## Why

Advanced automation workflows require release pipeline and release note management, pull-request/review inspection, global CLI installation (`linear`), and a policy-controlled raw GraphQL escape hatch (`linear api`) so new or specialized Linear schema fields can be queried without waiting for new CLI subcommands—while strictly preventing mutation bypasses or fake success on private Linear endpoints.

## What Changes

- Implement `src/modules/advanced/commands.ts`:
  - Releases & Release Notes: `linear release pipeline list`, `linear release list`, `linear release get <release>`, `linear release create`, `linear release update <release>`, `linear release-note list`, `linear release-note get <note>`, `linear release-note create`
  - Reviews / Linked PRs: `linear review list`, `linear review get <url-or-id>`, `linear review link --issue <issue> --url <pr-url>`, and public-API-honest `linear review comment|approve|request-changes|merge` returning `UNSUPPORTED_BY_PUBLIC_API` (`exit 9`) when Linear's public GraphQL schema lacks internal Diff mutations
  - Policy-Controlled Raw GraphQL: `linear api query` (AST-verified read-only `query` operations only) and `linear api mutation --allow-mutation` (AST-verified `mutation` operations with `--dry-run` and identity guardrails)
- Provide global CLI installer script (`scripts/install-global.sh`) and agent documentation (`README.md`, `README-zh.md`) inside `linear-cli`.

## Capabilities

### New Capabilities
- `releases-reviews-raw-graphql`: Release pipeline, release, and release-note commands; PR/review discovery, linking, and truthful public-API capability boundaries; AST-enforced raw GraphQL query and mutation commands; and global binary installation.

### Modified Capabilities

## Impact

- Adds `src/modules/advanced/commands.ts`, `scripts/install-global.sh`, `linear-cli/README.md`, `linear-cli/README-zh.md`, and `tests/sec-07-advanced/*`, and registers advanced commands in `src/cli/app.ts`.
