#!/bin/sh
set -eu

cli_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
bin_dir="${LINEAR_CLI_BIN_DIR:-$HOME/.local/bin}"

command -v node >/dev/null 2>&1 || { echo "Node.js >= 20.19 is required." >&2; exit 1; }

(cd "$cli_root" && npm run build)

mkdir -p "$bin_dir"
ln -sfn "$cli_root/dist/bin/linear.js" "$bin_dir/linear"
chmod +x "$cli_root/dist/bin/linear.js"

printf 'Installed global Linear CLI: %s -> %s\n' "$bin_dir/linear" "$cli_root/dist/bin/linear.js"
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) printf 'Note: add %s to your PATH.\n' "$bin_dir" ;;
esac
