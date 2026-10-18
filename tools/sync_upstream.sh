#!/usr/bin/env bash
# Bring new commits from the teammates' repos into SWE-Final, one branch + PR per repo.
#
#   tools/sync_upstream.sh            # check both, open a PR for each one that has new commits
#   tools/sync_upstream.sh frontend   # only one: agents | frontend
#   tools/sync_upstream.sh --check    # only report how many commits are new
#
#   agents   = SWE26-01/A2A-agents  -> repo root (agents/, spec/, homeassistant/, scripts/, plan.md …)
#   frontend = SWE26-01/SWE-frontend -> frontend/
#
# A2A-agents' history is this repo's root history, so it merges directly. SWE-frontend's history is
# rewritten into frontend/ with git-filter-repo first; the rewrite is deterministic, so commits that
# were imported before keep their ids and only the new ones are merged.
# Needs: gh (logged in), git-filter-repo (`pip install git-filter-repo`). Run with a clean worktree.
set -euo pipefail
ORG=SWE26-01
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

check=""
names=""
for arg in "$@"; do
  case $arg in
    --check) check=1 ;;
    agents | frontend) names="$names $arg" ;;
    *) echo "usage: $0 [--check] [agents] [frontend]" >&2; exit 2 ;;
  esac
done
names=${names:-agents frontend}

[ -z "$check" ] && [ -n "$(git status --porcelain)" ] && { echo "worktree not clean; commit or stash first" >&2; exit 1; }
command -v git-filter-repo >/dev/null || { echo "git-filter-repo missing: pip install git-filter-repo" >&2; exit 1; }
start=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin main

sync() { # name upstream-repo prefix(empty = root)
  local name=$1 repo=$2 prefix=$3 tmp new branch log
  tmp=$(mktemp -d)
  git clone -q --single-branch --branch main "https://github.com/$ORG/$repo.git" "$tmp/src"
  if [ -n "$prefix" ] && ! out=$(cd "$tmp/src" && git filter-repo --to-subdirectory-filter "$prefix" 2>&1); then
    echo "$out" >&2
    exit 1
  fi
  git fetch -q "$tmp/src" main
  rm -rf "$tmp"
  new=$(git rev-list --count origin/main..FETCH_HEAD)
  if [ "$new" = 0 ]; then
    echo "$name ($repo): up to date"
    return
  fi
  log=$(git log --no-merges --format='- %h %s (%an)' origin/main..FETCH_HEAD)
  echo "$name ($repo): $new new commit(s)"
  echo "$log"
  [ -n "$check" ] && return

  branch="sync/$name-$(date +%Y%m%d-%H%M)"
  git switch -q -c "$branch" origin/main
  if ! git merge -q --no-ff -m "Sync $ORG/$repo into ${prefix:-the root}" FETCH_HEAD; then
    echo "merge conflict on $branch: resolve, git commit, git push -u origin $branch, then open a PR" >&2
    exit 1
  fi
  git push -q -u origin "$branch"
  gh pr create -R "$ORG/SWE-Final" --base main --head "$branch" \
    --title "Sync $repo ($new commits)" \
    --body "$(printf '%s 의 새 커밋을 `%s`로 가져옵니다 (`tools/sync_upstream.sh`).\n\n%s\n' \
      "$ORG/$repo" "${prefix:-루트}/" "$log")"
  git switch -q "$start"
}

for name in $names; do
  case $name in
    agents) sync agents A2A-agents "" ;;
    frontend) sync frontend SWE-frontend frontend ;;
  esac
done
