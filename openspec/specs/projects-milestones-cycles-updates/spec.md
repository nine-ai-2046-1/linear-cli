# projects-milestones-cycles-updates Specification

## Purpose

Provides CLI commands for Linear projects, project milestones, team cycles, and project health status updates.

## Requirements

### Requirement: Project Discovery, Creation, Updates, and Lifecycle
The CLI SHALL provide `linear project list` (`--team`, `--status`, `--lead`, `--member`, `--query`, `--include-archived`), `linear project get <project>`, `linear project issues <project>`, `linear project create`, `linear project update <project>`, `linear project status <project> <status>`, `linear project archive <project>`, `linear project restore <project>`, and `linear project delete <project> --yes`.

#### Scenario: Create project with team, summary, and Markdown overview
- **WHEN** `linear project create --name "Q4 CLI" --team NIN --summary "CLI launch" --content-file overview.md --json` executes
- **THEN** the CLI resolves team `NIN`, calls `createProject` with `name`, `teamIds`, `description` (summary), and `content`, and returns the project record

#### Scenario: Project delete requires confirmation flag
- **WHEN** `linear project delete P-1 --non-interactive --json` runs without `--yes`
- **THEN** the CLI exits with code `5` (`VALIDATION_ERROR`) without deleting `P-1`

### Requirement: Project Milestone Management
The CLI SHALL provide `linear milestone list --project <project>`, `linear milestone get <milestone>`, `linear milestone create --project <project>`, and `linear milestone update <milestone>`.

#### Scenario: Create and update milestone on a project
- **WHEN** `linear milestone create --project "Q4 CLI" --name "Alpha" --target-date 2026-12-01 --json` executes
- **THEN** the CLI resolves the project UUID and creates milestone `"Alpha"` with `targetDate: "2026-12-01"`

### Requirement: Team Cycles and Cycle Issue Inspection
The CLI SHALL provide `linear cycle list --team <team>`, `linear cycle current --team <team>`, and `linear cycle issues <cycle> [--team <team>]` (supporting `current`, `next`, `previous`, cycle number, name, or UUID).

#### Scenario: Inspect current team cycle and its issues
- **WHEN** `linear cycle current --team NIN --json` and `linear cycle issues current --team NIN --json` execute
- **THEN** the CLI resolves team `NIN`'s active cycle and returns its metadata and paginated issues

### Requirement: Project Health Status Updates
The CLI SHALL provide `linear update list --project <project>`, `linear update create --project <project>` (`--body` or `--body-file`, `--health onTrack|atRisk|offTrack`), and `linear update edit <update>`.

#### Scenario: Publish project status update
- **WHEN** `linear update create --project "Q4 CLI" --health onTrack --body "All tasks green" --json` executes
- **THEN** the CLI calls `createProjectUpdate` and returns the published status update ID, health, and URL
