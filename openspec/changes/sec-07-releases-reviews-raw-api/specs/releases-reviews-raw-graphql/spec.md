# Spec Delta

## Purpose

Provides release management, PR/review discovery with truthful public-API boundaries, AST-guarded raw GraphQL execution, and global CLI installation.

## ADDED Requirements

### Requirement: Release Pipeline, Release, and Release Note Management
The CLI SHALL provide `linear release pipeline list`, `linear release list`, `linear release get <release>`, `linear release create`, `linear release update <release>`, `linear release-note list`, `linear release-note get <note>`, and `linear release-note create`.

#### Scenario: Create release and release note in a pipeline
- **WHEN** `linear release create --pipeline prod --name "v1.0.0" --version "1.0.0" --json` and `linear release-note create --pipeline prod --release rel-1 --content "Shipped" --json` execute
- **THEN** the CLI resolves the pipeline, creates the release and release note via `@linear/sdk`, and returns their records

### Requirement: Pull Request Review Discovery, Linking, and Public-API Truthfulness
The CLI SHALL provide `linear review list`, `linear review get <url-or-id>`, and `linear review link --issue <issue> --url <pr-url>`, and SHALL exit with code `9` (`UNSUPPORTED_BY_PUBLIC_API`) for `linear review comment|approve|request-changes|merge` when Linear's public GraphQL API does not expose internal Diff mutations.

#### Scenario: Review merge or approve reports truthful public-API boundary
- **WHEN** `linear review approve https://github.com/org/repo/pull/1 --json` executes against the public Linear GraphQL API
- **THEN** the CLI exits with code `9` (`UNSUPPORTED_BY_PUBLIC_API`) rather than faking approval

### Requirement: AST-Guarded Raw GraphQL Query and Mutation Execution
The CLI SHALL parse GraphQL documents before dispatch so `linear api query` executes only `query` operations (rejecting mutations with exit code `5` `VALIDATION_ERROR`) and `linear api mutation` requires `--allow-mutation`.

#### Scenario: Reject mutation passed to api query
- **WHEN** `linear api query --query "mutation { issueArchive(id: \"1\") { success } }" --json` executes
- **THEN** the CLI aborts before any network call with exit code `5` (`VALIDATION_ERROR`)

#### Scenario: Execute raw query via client.client.rawRequest
- **WHEN** `linear api query --query "query { viewer { id name } }" --json` executes
- **THEN** the CLI dispatches the query via `LinearGraphQLClient.rawRequest` and returns `data`
