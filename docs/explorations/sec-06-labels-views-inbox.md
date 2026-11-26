# Section 6 Exploration: Labels Lifecycle, Custom Views, and Inbox Notifications

## SDK Verification Findings

1. **Label Lifecycle (`issueLabelRetire` vs `deleteIssueLabel`)**:
   - In Linear, retiring a label (`client.issueLabelRetire(id)`) prevents new issues from applying it while preserving historical label associations on existing issues; `client.issueLabelRestore(id)` restores it.
   - `linear label archive <label>` calls `issueLabelRetire(id)` (safe, reversible with `linear label restore <label>`), and supports `--delete --yes` if permanent `deleteIssueLabel(id)` is explicitly requested.

2. **Custom Views**:
   - `client.customViews()` and `client.customView(id)` expose saved personal, team, and workspace views, including `modelName` (`Issue`, `Project`, `Initiative`), `shared`, `filterData`, and `slugId`.

3. **Inbox Notifications**:
   - `client.notifications()` lists the authenticated user's notifications (`readAt`, `snoozedUntilAt`, `type`, `category`, `createdAt`).
   - `client.updateNotification(id, { readAt: new Date() | null, snoozedUntilAt: Date | null })` marks notifications read/unread or snoozes/unsnoozes them.

```text
+--------------------+     +--------------------+     +--------------------+
|  `linear label`    |     |   `linear view`    |     |   `linear inbox`   |
| - create           |     | - list             |     | - list (--unread)  |
| - update           |     | - get <view>       |     | - read <id>        |
| - archive (retire) |     +--------------------+     | - unread <id>      |
| - restore          |                                | - snooze <id>      |
+--------------------+                                +--------------------+
```
