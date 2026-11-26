# folder-scoped-auth Specification

## Purpose

Provides strict folder-scoped Linear authentication (`<cwd>/.linear/auth.json`) so multiple project folders on the same machine operate under independent Linear accounts without credential leakage or fallback.

## Requirements

### Requirement: Strict Working-Directory Auth Resolution
The CLI SHALL resolve authentication exclusively from `.linear/auth.json` inside the active working directory (`--cwd` if specified, otherwise `process.cwd()`). The CLI MUST NOT traverse parent directories or fall back to any global credential file or global environment token.

#### Scenario: Two folders use independent Linear accounts
- **WHEN** `folder-a/.linear/auth.json` is bound to User A and `folder-b/.linear/auth.json` is bound to User B
- **THEN** running `linear auth status --json` in `folder-a` returns User A and running it in `folder-b` returns User B

#### Scenario: Subdirectory does not inherit parent directory auth
- **WHEN** `parent/.linear/auth.json` exists and the user runs `linear auth whoami --non-interactive` from `parent/child` where `parent/child/.linear/auth.json` does not exist
- **THEN** the CLI exits with exit code `2` (`AUTH_REQUIRED`) without reading `parent/.linear/auth.json`

### Requirement: Pluggable Secret Storage Without Plaintext Leakage
The CLI SHALL store raw secrets (API keys, OAuth access/refresh tokens, client secrets) in OS Keychain by default and write only non-secret metadata and a secret reference into `.linear/auth.json` (mode `0600` inside `0700` `.linear/` with `.linear/.gitignore`). When `--storage file` is explicitly passed, the CLI SHALL store secrets in `.linear/credentials.json` with mode `0600`.

#### Scenario: Default login keeps tokens out of auth.json
- **WHEN** a user completes `linear auth login --api-key` without `--storage file`
- **THEN** `.linear/auth.json` contains user/workspace metadata and a keychain reference, and contains no raw API key or bearer token

#### Scenario: Explicit file storage sets 0600 permissions and gitignore
- **WHEN** a user completes `linear auth login --api-key --storage file`
- **THEN** `.linear/credentials.json` is created with `0600` permissions and `.linear/.gitignore` ignores `*`

### Requirement: Personal API Key, OAuth PKCE, and App Client-Credentials Login
The CLI SHALL support `linear auth login` via OAuth 2.0 Authorization Code with PKCE (`S256`), `linear auth login --api-key` reading the key from stdin or masked prompt, and `linear auth login --app` using OAuth `client_credentials`, verifying `viewer` and `organization` before saving.

#### Scenario: API key login via stdin in non-interactive mode
- **WHEN** a valid personal API key is piped to `linear auth login --api-key --api-key-stdin --storage file --json --non-interactive`
- **THEN** the CLI verifies the viewer and workspace against Linear, persists `.linear/auth.json`, and outputs the bound account and workspace as JSON

#### Scenario: OAuth PKCE login exchanges authorization code
- **WHEN** `linear auth login` receives a valid OAuth callback matching `state`
- **THEN** the CLI exchanges the authorization code with `code_verifier`, verifies `viewer` and `organization`, and persists the folder binding

#### Scenario: App client-credentials login acquires app actor token
- **WHEN** valid OAuth client credentials are supplied to `linear auth login --app`
- **THEN** the CLI exchanges `grant_type=client_credentials` at `https://api.linear.app/oauth/token`, verifies the app actor identity, and stores the token and client credentials securely

### Requirement: Automatic Token Renewal Before Expiry and on 401
The CLI SHALL automatically renew expired or near-expiry OAuth authorization-code tokens (via `refresh_token`) and `client_credentials` tokens (via `client_id`/`client_secret`), coordinating concurrent renewals with a per-folder lockfile.

#### Scenario: Expired OAuth token refreshes transparently
- **WHEN** an authenticated command runs in a folder whose OAuth access token is expired and a valid refresh token is stored
- **THEN** the CLI exchanges the refresh token for a rotated token pair, saves both new tokens atomically, and completes the command

### Requirement: Status, Whoami, Reauth, Logout, and Revoke Lifecycle
The CLI SHALL provide `linear auth status`, `linear auth whoami`, `linear auth reauth`, `linear auth logout`, and `linear auth revoke`, operating strictly on the current folder's binding without affecting other folders.

#### Scenario: Logout removes only the current folder's credentials
- **WHEN** `linear auth logout --json` runs in `folder-a` while `folder-b` also has saved credentials
- **THEN** `folder-a`'s `.linear/auth.json` and stored secret are deleted while `folder-b` remains authenticated

#### Scenario: Revoke calls Linear revocation endpoint before cleanup
- **WHEN** `linear auth revoke --json` runs in an OAuth-authenticated folder
- **THEN** the CLI posts the token to `https://api.linear.app/oauth/revoke` and removes the local binding and stored secret

#### Scenario: Reauth replaces wrong account in place
- **WHEN** a folder is logged into User A and `linear auth reauth` completes with User B's credentials
- **THEN** `.linear/auth.json` and the secret store entry for that folder are updated to User B and `linear auth whoami` reports User B
