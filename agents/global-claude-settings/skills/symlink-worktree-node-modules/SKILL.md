---
name: symlink-worktree-node-modules
description: Use only when the user explicitly references this skill while inside a Git worktree and provides the main repository path containing an existing Node.js dependency installation.
disable-model-invocation: true
---

# Symlink Worktree Node Modules

Share an already-installed main project's dependencies with the current worktree without copying or reinstalling them.

## Invocation contract

Run this workflow only when the user explicitly names or references `symlink-worktree-node-modules`. Do not infer or auto-apply it from a missing `node_modules`, a worktree, or a request to set up dependencies.

The user must provide the main repository path. The command must be run from inside that repository's Git worktree. The skill maps the current worktree directory to the corresponding path under the supplied main repository, then links that package's `node_modules`.

When invoked from the worktree root, the skill discovers the unique tracked `package.json` directory under the main repository that already has an installed `node_modules`. If there is no unique candidate, refuse and ask the user to run the skill from the intended package directory.

## Safe procedure

Use the supplied path as the main repository path. Resolve paths with `cd -- ... && pwd -P`; do not use `realpath`, which is not available by default on stock macOS.

```sh
set -eu

main='USER_PROVIDED_MAIN_REPOSITORY_PATH'
case "$main" in
  \~) main="$HOME" ;;
  \~/*) main="$HOME/${main#\~/}" ;;
esac
worktree_abs=$(pwd -P)

if ! worktree_root=$(git -C "$worktree_abs" rev-parse --show-toplevel 2>/dev/null); then
  printf 'Refusing: current directory is not inside a Git worktree: %s\n' "$worktree_abs" >&2
  exit 1
fi
if ! worktree_root=$(cd -- "$worktree_root" 2>/dev/null && pwd -P); then
  printf 'Refusing: Git worktree root cannot be resolved\n' >&2
  exit 1
fi

if ! main_abs=$(cd -- "$main" 2>/dev/null && pwd -P); then
  printf 'Refusing: main repository is not a directory: %s\n' "$main" >&2
  exit 1
fi
if ! main_root=$(git -C "$main_abs" rev-parse --show-toplevel 2>/dev/null); then
  printf 'Refusing: supplied main path is not a Git repository: %s\n' "$main_abs" >&2
  exit 1
fi
if ! main_root=$(cd -- "$main_root" 2>/dev/null && pwd -P); then
  printf 'Refusing: main repository root cannot be resolved\n' >&2
  exit 1
fi
if [ "$main_root" != "$main_abs" ]; then
  printf 'Refusing: supplied main path must be the Git repository root: %s\n' "$main_abs" >&2
  exit 1
fi

worktree_rel=$(git -C "$worktree_abs" rev-parse --show-prefix)
worktree_rel=${worktree_rel%/}
project_rel="$worktree_rel"

if [ -z "$project_rel" ]; then
  candidate_count=0
  while IFS= read -r package_file; do
    [ -n "$package_file" ] || continue
    package_rel=${package_file%/package.json}
    [ "$package_rel" = "$package_file" ] && package_rel=.
    if [ -d "$main_abs/$package_rel/node_modules" ]; then
      candidate_count=$((candidate_count + 1))
      project_rel="$package_rel"
    fi
  done <<EOF
$(git -C "$main_abs" ls-files -- '*package.json')
EOF

  if [ "$candidate_count" -ne 1 ]; then
    printf 'Refusing: expected one main package with installed node_modules, found %s\n' "$candidate_count" >&2
    exit 1
  fi
fi

source_dir="$main_abs/$project_rel/node_modules"
if [ ! -d "$source_dir" ]; then
  printf 'Refusing: installed source node_modules directory is missing: %s\n' "$source_dir" >&2
  exit 1
fi

if ! source_abs=$(cd -- "$source_dir" 2>/dev/null && pwd -P); then
  printf 'Refusing: source node_modules cannot be resolved: %s\n' "$source_dir" >&2
  exit 1
fi

target="$worktree_root/$project_rel/node_modules"
if [ -e "$target" ] || [ -L "$target" ]; then
  printf 'Refusing: worktree node_modules already exists: %s\n' "$target" >&2
  exit 1
fi

if ! ln -s "$source_abs" "$target"; then
  printf 'Refusing: could not create link; target may have appeared: %s\n' "$target" >&2
  exit 1
fi

if [ ! -L "$target" ] || [ ! -d "$target" ]; then
  printf 'Verification failed: created target is not a usable node_modules symlink: %s\n' "$target" >&2
  exit 1
fi

resolved_target=$(cd -- "$target" && pwd -P)
if [ "$resolved_target" != "$source_abs" ]; then
  printf 'Verification failed: link resolves to %s, expected %s\n' "$resolved_target" "$source_abs" >&2
  exit 1
fi

printf 'Linked %s -> %s (package path: %s)\n' "$target" "$source_abs" "$project_rel"
```

Replace only `USER_PROVIDED_MAIN_REPOSITORY_PATH` with the path from the user's request. Keep every path quoted. Do not use `ln -sf`, `rm`, `mv`, `mkdir`, or any command that removes or overwrites the worktree target.

## Refusal rules

Refuse without changing anything when:

- the user did not provide a main repository path;
- the current directory is not inside a Git worktree;
- the supplied main path is not the root of a Git repository;
- the current worktree-relative package path does not exist under the main repository;
- invocation from the worktree root does not identify exactly one tracked package with installed `node_modules`;
- the mapped main project's `node_modules` is missing or is not a directory;
- the mapped worktree target exists as a directory, a valid symlink, or a dangling symlink; or
- link creation or verification fails.

The target check must include both `-e` and `-L`: `-e` does not detect a dangling symlink, while `-L` does. Never remove an existing target to make the operation succeed.

## Verification output

Report the exact worktree link path and the canonical main `node_modules` path after successful verification. For refusal, report the failed condition and the corrective action; do not claim a link was created.

## Common mistakes

| Mistake | Correction |
|---|---|
| Auto-triggering on any worktree dependency request | Require an explicit reference to this skill; `disable-model-invocation: true` enforces manual invocation. |
| Using `realpath` | Resolve with `cd -- "$path" && pwd -P` on macOS. |
| Checking only `[ -e "$target" ]` | Also check `[ -L "$target" ]` to protect dangling symlinks. |
| Using `ln -sf` or deleting the target | Refuse; existing worktree dependencies may be user data. |
| Creating `node_modules` in the main project | Refuse; dependencies must already be installed there. |
| Creating a relative link based on guessed directory depth | Map the Git-relative package path and use the verified absolute source path. |
