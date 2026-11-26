# Section 2 Exploration: Workspace, Users, Teams, Statuses, Templates & Resolvers

## Context & Human-Friendly Resolution Flow

Daily Linear workflows rarely pass raw UUIDs on the command line. Users and agent skills write `--team NIN`, `--assignee "Raymond Magic"`, `--assignee me`, or `--status "In Progress"`. However, Linear workspace names can collide (for example, two users named "Alex" or a workspace label and team label sharing a name).

```text
+-------------------------------------------------------------------+
|  User / Agent Input: "me" | "NIN" | "Raymond Magic" | UUID        |
+---------------------------------+---------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|                  src/core/resolvers.ts                            |
|  1. Exact UUID v4 match? -> direct lookup                         |
|  2. "me" (for user)?     -> client.viewer                         |
|  3. Exact key/email/name match -> 1 match: return UUID            |
|                                -> 0 matches: exit 4 NOT_FOUND     |
|                                -> >1 matches: exit 6 AMBIGUOUS    |
+-------------------------------------------------------------------+
```

## Section 2 Command Inventory

- `linear workspace info`
- `linear me`
- `linear user list [--query <q>] [--team <team>] [--include-disabled] [--limit <n>] [--cursor <c>] [--sort created|updated]`
- `linear user get <user>`
- `linear team list [--query <q>] [--include-archived] [--limit <n>] [--cursor <c>] [--sort created|updated]`
- `linear team get <team>`
- `linear team members <team> [--limit <n>] [--cursor <c>]`
- `linear status list --team <team>`
- `linear label list [--team <team>] [--include-groups] [--include-archived] [--limit <n>] [--cursor <c>]` (shared/extended in Section 6)
- `linear template list [--team <team>] [--type <type>]`
- `linear template get <template>`
