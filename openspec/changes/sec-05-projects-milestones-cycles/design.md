# Design

## Context

See `proposal.md` for motivation. Planning entities in Linear span workspace/team projects (`Project`), project-scoped milestones (`ProjectMilestone`) and updates (`ProjectUpdate`), and team-scoped cycles (`Cycle`).

## Goals / Non-Goals

**Goals:**
- Resolve project statuses accurately via `client.projectStatuses()` (distinct from issue `workflowStates`).
- Support ergonomic cycle selectors (`current`, `next`, `previous`, cycle number like `12`, or UUID).

**Non-Goals:**
- Workspace-level Initiatives CRUD (out of requested Sections 1–7 scope).

## Decisions

### 1. Project Status & Cycle Resolution

```text
`linear project status <proj> "In Progress"`
    ---> `client.projectStatuses()` ---> exact name/type match ---> `updateProject(id, { statusId })`

`linear cycle issues current --team NIN`
    ---> `team.activeCycle` (or date-window fallback) ---> `cycle.issues(...)`
```

## Risks / Trade-offs

- **[Risk] App actor attempting `--lead me` on project create/update** → Mitigation: Linear prohibits app users from being project leads or members; validate or surface Linear's validation message clearly with `VALIDATION_ERROR`.
