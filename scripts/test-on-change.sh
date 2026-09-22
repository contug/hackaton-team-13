#!/usr/bin/env bash
#
# PostToolUse hook: run the tests related to the file that was just edited.
#
# Wired up in `.claude/settings.json`, which is committed, so this runs in every
# clone and every worktree without anyone having to remember it. It is a safety
# net, not a substitute for `npm run check` — only *related* tests run here.
#
# Exit codes: 0 = nothing to do or tests passed; 2 = tests failed, and the output
# is fed back into the session on stderr.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
payload="$(cat)"

file_path="$(
  printf '%s' "$payload" | node -e "
    let raw = '';
    process.stdin.on('data', (chunk) => (raw += chunk));
    process.stdin.on('end', () => {
      try {
        process.stdout.write(String(JSON.parse(raw)?.tool_input?.file_path ?? ''));
      } catch {
        process.stdout.write('');
      }
    });
  " 2>/dev/null
)"

[ -n "$file_path" ] || exit 0

# Normalize to a repo-relative path; anything outside the repo is not ours.
rel="${file_path#"$root"/}"
case "$rel" in
  /*) exit 0 ;;
esac

# Only source and test files can change what the suite asserts. Editing
# CLAUDE.md, a config file or the changelog must not trigger a run.
case "$rel" in
  lib/*.ts | lib/*.tsx | components/*.ts | components/*.tsx | \
  entrypoints/*.ts | entrypoints/*.tsx | entrypoints/*/*.ts | entrypoints/*/*.tsx | \
  tests/*.ts | tests/*.tsx) ;;
  *) exit 0 ;;
esac

[ -f "$root/$rel" ] || exit 0
[ -d "$root/node_modules/vitest" ] || exit 0

# A test file runs directly; anything else runs whatever imports it.
case "$rel" in
  tests/*.test.ts | tests/*.test.tsx) args=(run "$rel") ;;
  *) args=(related --run "$rel") ;;
esac

output="$(cd "$root" && npx vitest "${args[@]}" --passWithNoTests --reporter=dot 2>&1)"
status=$?

if [ "$status" -ne 0 ]; then
  {
    echo "Tests related to $rel failed. Fix them before moving on."
    echo
    echo "$output"
  } >&2
  exit 2
fi

exit 0
