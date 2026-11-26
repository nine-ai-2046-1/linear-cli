# Proposal

## Why

Roadmap planning, sprint/cycle tracking, milestone checkpoints, and executive status updates are core daily workflows in Linear alongside issue tracking. Agents turning planning docs into structured projects or summarizing active sprints need direct CLI commands for projects, milestones, cycles, and project health updates.

## What Changes

- Implement `src/modules/planning/commands.ts`:
  - Projects: `linear project list`, `linear project get <project>`, `linear project issues <project>`, `linear project create`, `linear project update <project>`, `linear project status <project> <status>`, `linear project archive <project>`, `linear project restore <project>`, `linear project delete <project> --yes`
  - Milestones: `linear milestone list --project <project>`, `linear milestone get <milestone>`, `linear milestone create --project <project>`, `linear milestone update <milestone>`
  - Cycles: `linear cycle list --team <team>`, `linear cycle current --team <team>`, `linear cycle issues <cycle> [--team <team>]`
  - Project Status Updates: `linear update list --project <project>`, `linear update create --project <project>`, `linear update edit <update>`

## Capabilities

### New Capabilities
- `projects-milestones-cycles-updates`: Project CRUD/status/archive/restore/delete/issues, project milestones CRUD, team cycles discovery and cycle issues, and project health status updates.

### Modified Capabilities

## Impact

- Adds `src/modules/planning/commands.ts` and `tests/sec-05-planning/*`, and registers `project`, `milestone`, `cycle`, and `update` commands in `src/cli/app.ts`.
