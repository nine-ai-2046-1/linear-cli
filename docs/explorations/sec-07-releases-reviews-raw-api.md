# Section 7 Exploration: Releases, Reviews/Diffs Capability Boundary, and Raw GraphQL

## Verified Public GraphQL Schema Capabilities vs Internal Endpoints

During exploration we inspected `@linear/sdk@104.0.0` AND live GraphQL introspection against `https://api.linear.app/graphql`:

1. **Releases & Release Notes (Fully Supported in `@linear/sdk@104.0.0`!)**:
   - `client.releasePipelines()`, `client.releases()`, `client.release(id)`, `client.createRelease(input)`, `client.updateRelease(id, input)`
   - `client.releaseNotes()`, `client.releaseNote(id)`, `client.createReleaseNote(input)`, `client.updateReleaseNote(id, input)`
   - Note: workspaces without Release Management enabled on their plan may return a workspace feature error from Linear, which our CLI surfaces cleanly.

2. **Reviews / Diffs (`linear review ...`)**:
   - Live introspection of `https://api.linear.app/graphql` confirmed `Query` and `Mutation` expose **zero** `diff` / `submitDiffReview` / `mergeDiff` fields in Linear's public GraphQL API (those exist only inside Linear's private hosted MCP worker).
   - Public GraphQL DOES expose:
     - `semanticSearch(query, { types: ["pullRequest"] })` and PR attachments (`attachments` / `attachmentsForURL` / `attachmentLinkGitHubPR` / `attachmentLinkGitLabMR`)!
   - Therefore:
     - `linear review list` and `linear review get <url-or-id>` query linked PR attachments and `semanticSearch` (`PullRequest`) so users can inspect PRs linked in Linear!
     - `linear review link --issue <issue> --url <pr-url>` links a GitHub PR / GitLab MR to an issue via `attachmentLinkGitHubPR` / `attachmentLinkGitLabMR`!
     - `linear review comment`, `linear review approve`, `linear review request-changes`, and `linear review merge` validate flags (`--yes` for merge, `--dry-run` preview) and fail truthfully with exit code `9` (`UNSUPPORTED_BY_PUBLIC_API`) explaining that Linear's public GraphQL API does not expose Diff review/merge mutations (recommending `gh pr` or Linear MCP) unless a custom adapter is injected! Never fake mutation success!

3. **Raw GraphQL Escape Hatch (`linear api query` & `linear api mutation`)**:
   - Parses the GraphQL document AST using `graphql.parse()` BEFORE sending!
   - `linear api query` rejects any document containing a `mutation` or `subscription` operation (`VALIDATION_ERROR` exit 5) so `api query` can NEVER be used as a write bypass!
   - `linear api mutation` requires `--allow-mutation` (and respects `--dry-run`, `--expect-workspace`, and `--expect-user`).
