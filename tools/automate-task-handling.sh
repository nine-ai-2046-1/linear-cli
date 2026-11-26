#!/usr/bin/env bash
# linear-task-catcher — one-shot, machine-parseable answer for automation:
#
#   stdout (exactly one line, exit 0):
#     invalid-auth                       folder has no valid Linear login
#     no-backlog-tasks                   logged in, zero Backlog issues assigned to me
#     NIN-1,NIN-2                        logged in, comma-joined sorted identifiers
#   failure to determine an answer:
#     empty stdout + stderr diagnostic, exit 1
#
# Read-only: only `linear auth whoami` and `linear issue mine` are invoked,
# always with --json --non-interactive, never with cd/--cwd so the caller's
# folder-scoped auth applies. Bash 3.2-safe (macOS default shell).
# Contract: openspec/changes/add-linear-task-catcher (design D1-D7).

set -u

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

# --- 1. CLI discovery (D3): ${LINEAR_BIN:-linear}, else stderr + exit 1 ---
if [ -n "${LINEAR_BIN:-}" ]; then
  # Intentional word splitting: LINEAR_BIN may be a multi-word command
  # such as "node /path/to/dist/bin/linear.js" (used by integration tests).
  # shellcheck disable=SC2206
  LINEAR_CMD=($LINEAR_BIN)
else
  LINEAR_CMD=(linear)
fi

CLI_PROG="${LINEAR_CMD[0]}"
if ! command -v "$CLI_PROG" >/dev/null 2>&1; then
  die "linear-task-catcher: linear CLI not found ('$CLI_PROG'); install the linear CLI or set LINEAR_BIN"
fi

# --- 2. Auth gate: any non-zero whoami -> invalid-auth, exit 0 (D4, D5) ---
"${LINEAR_CMD[@]}" auth whoami --json --non-interactive >/dev/null
if [ $? -ne 0 ]; then
  # CLI diagnostics already passed through to stderr untouched.
  printf 'invalid-auth\n'
  exit 0
fi

# --- 3. Backlog query: paginated issue mine (D6), node-based parsing (D2) ---
ALL_IDS=""
CURSOR=""
while :; do
  if [ -n "$CURSOR" ]; then
    PAGE=$("${LINEAR_CMD[@]}" issue mine --status Backlog --limit 250 --json --non-interactive --cursor "$CURSOR")
  else
    PAGE=$("${LINEAR_CMD[@]}" issue mine --status Backlog --limit 250 --json --non-interactive)
  fi
  if [ $? -ne 0 ]; then
    die "linear-task-catcher: linear issue query failed after successful authentication"
  fi

  # Parse one page: first output line = next cursor (empty when done),
  # remaining lines = identifiers from this page. Exit 1 on malformed JSON.
  PAGE_OUT=$(printf '%s' "$PAGE" | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      let j;
      try { j = JSON.parse(raw); } catch (e) { process.exit(1); }
      if (!j || j.ok !== true || !Array.isArray(j.data) || !j.pageInfo) process.exit(1);
      const ids = j.data
        .map((x) => (x && typeof x.identifier === "string" ? x.identifier : null))
        .filter((x) => x !== null);
      const next = j.pageInfo.hasNextPage && j.pageInfo.endCursor ? j.pageInfo.endCursor : "";
      process.stdout.write(next + "\n" + ids.join("\n") + (ids.length ? "\n" : ""));
      process.exit(0);
    });
  ')
  if [ $? -ne 0 ]; then
    die "linear-task-catcher: malformed response from linear CLI (could not parse JSON)"
  fi

  NEXT=$(printf '%s\n' "$PAGE_OUT" | sed -n '1p')
  PAGE_IDS=$(printf '%s\n' "$PAGE_OUT" | sed -n '2,$p')

  if [ -n "$PAGE_IDS" ]; then
    if [ -z "$ALL_IDS" ]; then
      ALL_IDS="$PAGE_IDS"
    else
      ALL_IDS="$ALL_IDS
$PAGE_IDS"
    fi
  fi

  if [ -z "$NEXT" ]; then
    break
  fi
  CURSOR="$NEXT"
done

# --- 4. Emit exactly one payload line (D5, D7): sorted, comma-joined ---
RESULT=$(printf '%s\n' "$ALL_IDS" | node -e '
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    const ids = raw.split("\n").filter((s) => s.length > 0).sort();
    process.stdout.write(ids.join(","));
  });
')

if [ -z "$RESULT" ]; then
  printf 'no-backlog-tasks\n'
else
  printf '%s\n' "$RESULT"
fi
exit 0
