# Design

## Context

See `proposal.md` for motivation. Section 7 completes the full Sections 1–7 feature surface, enforces GraphQL AST operation safety on raw API access, and installs the `linear` executable globally into `~/.local/bin/linear`.

## Goals / Non-Goals

**Goals:**
- Prevent `linear api query` from ever becoming a policy bypass for mutations by parsing the GraphQL AST with `graphql.parse()`.
- Never pretend unsupported private Linear Diff mutations succeeded; return deterministic exit code `9` (`UNSUPPORTED_BY_PUBLIC_API`).

**Non-Goals:**
- Hosting an inbound public HTTPS webhook server (Linear webhooks require a public non-localhost HTTPS endpoint).

## Decisions

### 1. GraphQL AST Guardrail (`linear api`)

```text
GraphQL string / --file ---> `graphql.parse(doc)`
                                  |
         +------------------------+------------------------+
         | `api query`                                     | `api mutation`
         v                                                 v
Every DefinitionNode must be                      Requires `--allow-mutation`;
OperationDefinition(operation="query")            respects `--dry-run` + identity
or FragmentDefinition; else exit 5!               guardrails before rawRequest!
```

## Risks / Trade-offs

- **[Risk] Raw GraphQL variables containing secrets in error logs** → Mitigation: Route raw GraphQL responses and errors through `OutputWriter` secret redaction.
