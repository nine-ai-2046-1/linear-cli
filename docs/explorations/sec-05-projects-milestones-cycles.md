# Section 5 Exploration: Projects, Milestones, Cycles, and Project Status Updates

## Planning Domain Hierarchy

```text
+-------------------------------------------------------------------+
|                           Team(s)                                 |
+-----------------+---------------------------------+---------------+
                  |                                 |
                  v                                 v
        +-------------------+             +-------------------+
        |     Project       |             |      Cycle        |
        | (statusId, lead,  |             | (current / #num / |
        |  start/targetDate)|             |  startsAt..endsAt)|
        +----+---------+----+             +---------+---------+
             |         |                            |
             v         v                            v
    +------------+ +----------------+       +---------------+
    | Milestones | | ProjectUpdates |       | Cycle Issues  |
    +------------+ +----------------+       +---------------+
```

## SDK Nuances Verified in `@linear/sdk@104.0.0`

1. **Project Statuses vs Issue Workflow States**: Projects use `client.projectStatuses()` (`statusId` on `ProjectCreateInput` / `ProjectUpdateInput`), NOT `workflowStates`! `linear project status <project> <status>` resolves against `projectStatuses()`.
2. **Summary vs Overview Content**: `ProjectCreateInput.description` is the short plain-text summary (<=255 chars in UI), while `ProjectCreateInput.content` is the full Markdown overview! Our CLI exposes both `--summary` and `--content` / `--content-file`.
3. **App User Lead/Member Restriction**: Linear forbids application users (`isApp: true`) from being project leads or project members. If an app actor attempts to set itself as lead/member, our CLI catches or reports a clear validation/API error.
4. **Project Updates**: `client.projectUpdates()`, `client.createProjectUpdate({ projectId, body, health })`, and `client.updateProjectUpdate(id, { body, health })` where `health` is `onTrack | atRisk | offTrack`.
