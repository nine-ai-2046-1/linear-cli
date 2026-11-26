# workspace-directory-discovery Specification

## Purpose

Enables deterministic discovery of Linear workspace metadata, users, teams, workflow statuses, labels, and templates, along with ambiguity-safe human-friendly reference resolution across the CLI.

## Requirements

### Requirement: Workspace and Authenticated Viewer Inspection
The CLI SHALL provide `linear workspace info` returning workspace `id`, `name`, `urlKey`, and `url`, and `linear me` returning the authenticated viewer's `id`, `name`, `displayName`, `email`, `admin`, `guest`, `active`, and `isApp` flags.

#### Scenario: Inspect workspace and viewer in JSON mode
- **WHEN** `linear workspace info --json` and `linear me --json` execute in an authenticated folder
- **THEN** both commands return `ok: true` with workspace and viewer fields respectively

### Requirement: User Directory Listing and Lookup
The CLI SHALL provide `linear user list` supporting `--query`, `--team`, `--include-disabled`, `--limit`, `--cursor`, and `--sort`, and `linear user get <user>` resolving `me`, UUID, email, displayName, or full name.

#### Scenario: Filter users by query or team
- **WHEN** `linear user list --query raymond --team NIN --json` executes
- **THEN** the CLI returns matching active users in team `NIN` with Relay `pageInfo`

#### Scenario: Ambiguous user name fails explicitly
- **WHEN** `linear user get Alex --json` runs in a workspace with two active users named `Alex`
- **THEN** the CLI exits with code `6` (`AMBIGUOUS_RESOURCE`) listing the candidate user IDs and emails

### Requirement: Team Listing, Details, and Membership Discovery
The CLI SHALL provide `linear team list`, `linear team get <team>` (by UUID, team key such as `NIN`, or exact name), and `linear team members <team>`.

#### Scenario: Lookup team by key and list members
- **WHEN** `linear team get NIN --json` and `linear team members NIN --json` execute
- **THEN** the CLI resolves `NIN` to its team UUID and returns team details and paginated members

### Requirement: Team Workflow Status and Label Discovery
The CLI SHALL provide `linear status list --team <team>` returning workflow states ordered by position, and `linear label list` with optional `--team`, `--include-groups`, and `--include-archived` filters.

#### Scenario: List workflow statuses for a team
- **WHEN** `linear status list --team NIN --json` executes
- **THEN** the CLI returns each status's `id`, `name`, `type`, `color`, and `position` for team `NIN`

### Requirement: Template Listing and Details
The CLI SHALL provide `linear template list` supporting `--team` and `--type`, and `linear template get <template>` resolving a template by UUID or exact name.

#### Scenario: List and inspect templates
- **WHEN** `linear template list --type issue --json` and `linear template get <id-or-name> --json` execute
- **THEN** the CLI returns matching template summaries and the selected template's full Markdown/metadata
