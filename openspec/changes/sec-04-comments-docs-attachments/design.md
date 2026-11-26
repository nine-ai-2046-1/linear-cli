# Design

## Context

See `proposal.md` for motivation. Section 4 introduces two external HTTP interactions alongside SDK GraphQL calls: pre-signed GCS/Linear `PUT` uploads and authenticated private-asset `GET` downloads.

## Goals / Non-Goals

**Goals:**
- Preserve exact signed headers returned by `fileUpload` during `PUT` so Google Cloud Storage signatures never fail with `403`.
- Prevent Linear credentials from ever being sent to non-Linear domains during attachment downloads.

**Non-Goals:**
- Editing binary contents of already-uploaded files (Linear treats uploaded assets as immutable; updates create a new upload).

## Decisions

### 1. Host-Scoped Credential Forwarding on Download

```text
Download URL ---> Host === "uploads.linear.app" ?
                     |                    |
                    YES                   NO
                     |                    |
                     v                    v
       Send folder Authorization    Fetch without Authorization
```

- **Rationale**: Issue attachments can link to arbitrary third-party URLs (Sentry, GitHub, Jira, customer URLs). Scoping `Authorization` strictly to `uploads.linear.app` prevents credential leakage.

## Risks / Trade-offs

- **[Risk] Pre-signed upload URL expires (60s window)** → Mitigation: Read and stat the local file before calling `fileUpload`, then immediately execute the `PUT` and `createAttachment` in sequence.
