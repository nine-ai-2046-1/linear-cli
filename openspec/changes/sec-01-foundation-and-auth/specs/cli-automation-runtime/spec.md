# Spec Delta

## Purpose

Defines the cross-cutting CLI automation contract for agents and CI workflows, including structured JSON envelopes, non-interactive behavior, identity assertions, dry-run previews, rate-limit backoff, and create-mutation timeout safety.

## ADDED Requirements

### Requirement: Structured JSON Output and Secret Redaction
When `--json` is passed, the CLI SHALL emit valid JSON on stdout for all successes and structured JSON errors on stderr (or stdout error envelope when requested) without ANSI control codes, and MUST redact bearer tokens, API keys, and client secrets from all outputs.

#### Scenario: JSON flag emits deterministic machine-readable payload
- **WHEN** any command succeeds with `--json`
- **THEN** stdout contains a single valid JSON document with `ok: true` and `data`, and exit code is `0`

#### Scenario: Error details redact sensitive credentials
- **WHEN** an operation throws an error containing an `Authorization` header or `lin_api_` key
- **THEN** the rendered message and JSON error payload replace the secret value with `[REDACTED]`

### Requirement: Non-Interactive Prompt Guard and Deterministic Exit Codes
When `--non-interactive` is set or stdin/stdout is not a TTY, the CLI MUST NOT wait for user input and SHALL fail immediately with deterministic exit codes (`2` `AUTH_REQUIRED`, `3` `FORBIDDEN`, `4` `NOT_FOUND`, `5` `VALIDATION_ERROR`, `6` `AMBIGUOUS_RESOURCE`, `7` `RATE_LIMITED`, `8` `OUTCOME_UNKNOWN`, `9` `UNSUPPORTED_BY_PUBLIC_API`, `10` `NETWORK_ERROR`).

#### Scenario: Missing folder auth fails fast in non-interactive mode
- **WHEN** an authenticated command runs in an unauthenticated folder with `--non-interactive --json`
- **THEN** the CLI exits immediately with code `2` and error code `AUTH_REQUIRED` without prompting

### Requirement: Expected Workspace and User Guardrails
When `--expect-workspace` or `--expect-user` is provided (or bound in `.linear/auth.json`), the CLI SHALL verify the active identity matches before executing mutations and fail with exit code `3` (`FORBIDDEN`) on mismatch.

#### Scenario: Wrong workspace blocks execution
- **WHEN** a command runs with `--expect-workspace other-org` while the folder is bound to `nineai`
- **THEN** the CLI aborts with exit code `3` and error code `FORBIDDEN`

### Requirement: Dry-Run Mutation Preview
When `--dry-run` is passed to any write command, the CLI SHALL resolve inputs and emit a structured preview (`dryRun: true`, planned operation and resolved parameters) without executing the Linear mutation.

#### Scenario: Dry-run previews mutation without side effects
- **WHEN** a mutation command runs with `--dry-run --json`
- **THEN** the CLI performs read-only validation/resolution, skips the GraphQL mutation, and returns `dryRun: true` with exit code `0`

### Requirement: Rate-Limit Retry and Create-Timeout Safety
The CLI SHALL retry idempotent/read requests on HTTP `429` or GraphQL `RATELIMITED` respecting `Retry-After` up to a bounded retry count, and MUST NOT blindly retry non-idempotent create mutations after a network timeout, returning exit code `8` (`OUTCOME_UNKNOWN`) instead.

#### Scenario: Rate-limited read retries and succeeds
- **WHEN** a read query receives a `429` response with `Retry-After: 0` followed by `200 OK`
- **THEN** the CLI waits according to `Retry-After`, retries the read once, and returns the successful result

#### Scenario: Timed-out create mutation returns OUTCOME_UNKNOWN
- **WHEN** a non-idempotent create operation encounters a request timeout after dispatch
- **THEN** the CLI does not send a second create request and exits with code `8` (`OUTCOME_UNKNOWN`)
