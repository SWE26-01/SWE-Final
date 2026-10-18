#!/usr/bin/env bash
# Bring new commits from SWE26-01/A2A-agents into SWE-Final on a sync/* branch and open a PR.
#
#   tools/sync_upstream.sh            # open a PR if A2A-agents has new commits
#   tools/sync_upstream.sh --check    # only report how many commits are new
#
# A2A-agents is the repo root here (agents/, spec/, homeassistant/, scripts/, plan.md …) and shares
# its history, so new commits merge directly. frontend/ came from SWE26-01/SWE-frontend but is now
# developed here, so it is no longer synced.
# Needs: gh (logged in). Run with a clean worktree.
set -euo pipefail
ORG=SWE26-01
REPO=A2A-agents
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

check=""
for arg in "$@"; do
  case $arg in
    --check) check=1 ;;
    *) echo "usage: $0 [--check]" >&2; exit 2 ;;
  esac
done

[ -z "$check" ] && [ -n "$(git status --porcelain)" ] && { echo "worktree not clean; commit or stash first" >&2; exit 1; }
start=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin main
git fetch -q "https://github.com/$ORG/$REPO.git" main

new=$(git rev-list --count origin/main..FETCH_HEAD)
if [ "$new" = 0 ]; then
  echo "$REPO: up to date"
  exit 0
fi
log=$(git log --no-merges --format='- %h %s (%an)' origin/main..FETCH_HEAD)
echo "$REPO: $new new commit(s)"
echo "$log"
[ -n "$check" ] && exit 0

branch="sync/agents-$(date +%Y%m%d-%H%M)"
git switch -q -c "$branch" origin/main
if ! git merge -q --no-ff -m "Sync $ORG/$REPO into the root" FETCH_HEAD; then
  echo "merge conflict on $branch: resolve, git commit, git push -u origin $branch, then open a PR" >&2
  exit 1
fi
git push -q -u origin "$branch" 2>&1 | grep -v '^remote:' || true
gh pr create -R "$ORG/SWE-Final" --base main --head "$branch" \
  --title "Sync $REPO ($new commits)" \
  --body "$(printf '%s 의 새 커밋을 루트로 가져옵니다 (`tools/sync_upstream.sh`).\n\n%s\n' "$ORG/$REPO" "$log")"
git switch -q "$start"
git branch -q -D "$branch" # pushed; the PR keeps it
