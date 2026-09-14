#!/usr/bin/env bash
# Deploy this checkout to sumin6475/hait-turn-taking as one snapshot commit.
#
# The turn-taking repository starts at a history-less import and must stay that
# way: this repository's history still carries the prompt management system and
# a pilot data export. So a deploy never pushes this branch. It takes the tree of
# the last commit here, commits it on top of turn-taking's main, and pushes that
# one commit. Nothing is merged, so nothing can conflict.
#
# Two refusals keep it from silently losing work:
#   - turn-taking's main was changed outside this script (its files differ from
#     the commit it says it came from), so replacing them would undo that change;
#   - the commit being deployed does not contain the last deployed commit, so
#     deploying it would roll work back.
#
# Usage:  npm run deploy:turn-taking            deploy the last commit
#         npm run deploy:turn-taking -- --dry-run   show what would go, push nothing
set -euo pipefail

REMOTE=turn-taking
URL=https://github.com/sumin6475/hait-turn-taking.git
BRANCH=main
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

cd "$(git rev-parse --show-toplevel)"

git remote get-url "$REMOTE" >/dev/null 2>&1 || git remote add "$REMOTE" "$URL"
if [[ "$(git remote get-url "$REMOTE")" != "$URL" ]]; then
  echo "✗ remote '$REMOTE' points at $(git remote get-url "$REMOTE"), not $URL"; exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  if [[ $DRY_RUN == 1 ]]; then
    echo "! uncommitted changes are not part of a deploy; only the last commit is"
  else
    echo "✗ uncommitted changes. A deploy sends the last commit only — commit first."; exit 1
  fi
fi

SOURCE=$(git rev-parse HEAD)
TREE=$(git rev-parse "HEAD^{tree}")

# What was removed from the turn-taking import must never reach it, even if it
# is force-added here later.
for path in prompt-management-system .pnpm-store .vscode.local-backup final-touch server/pilot-export.json; do
  if git cat-file -e "HEAD:$path" 2>/dev/null; then
    echo "✗ $path is tracked in $(git rev-parse --short HEAD); it must not be deployed"; exit 1
  fi
done
if git ls-tree -r --name-only HEAD | grep -E '(^|/)\.env($|\.)' | grep -v '\.example$'; then
  echo "✗ an .env file is tracked; it must not be deployed"; exit 1
fi
SECRET_PATTERN='sk-[A-Za-z0-9_-]{20,}|mongodb(\+srv)?://[^<" ]+:[^<" ]+@'
if git grep -qIE "$SECRET_PATTERN" HEAD -- .; then
  echo "✗ something that looks like an API key or a database password is tracked:"
  git grep -nIE "$SECRET_PATTERN" HEAD -- . | cut -c1-120
  exit 1
fi

git fetch -q "$REMOTE" "$BRANCH"
PARENT=$(git rev-parse "$REMOTE/$BRANCH")
PARENT_TREE=$(git rev-parse "$PARENT^{tree}")

# Every commit on turn-taking's main names the commit here it was taken from:
# a Source-Commit trailer, or "develop at <sha>" on the first import.
BODY=$(git log -1 --format=%B "$PARENT")
LAST_SOURCE=$(printf '%s\n' "$BODY" | sed -n 's/^Source-Commit: \([0-9a-f]\{7,40\}\)$/\1/p' | tail -1)
if [[ -z "$LAST_SOURCE" ]]; then
  LAST_SOURCE=$(printf '%s\n' "$BODY" | sed -n 's/.*develop at \([0-9a-f]\{7,40\}\).*/\1/p' | head -1)
fi
if [[ -z "$LAST_SOURCE" ]] || ! git cat-file -e "$LAST_SOURCE^{commit}" 2>/dev/null; then
  echo "✗ $REMOTE/$BRANCH ($(git rev-parse --short "$PARENT")) does not name a commit this checkout has"; exit 1
fi
if [[ "$(git rev-parse "$LAST_SOURCE^{tree}")" != "$PARENT_TREE" ]]; then
  echo "✗ $REMOTE/$BRANCH was changed outside this script: its files differ from $(git rev-parse --short "$LAST_SOURCE")."
  echo "  Bring that change into this checkout and commit it, then deploy again."; exit 1
fi
if ! git merge-base --is-ancestor "$LAST_SOURCE" HEAD; then
  echo "✗ $(git rev-parse --short HEAD) does not contain the last deployed commit $(git rev-parse --short "$LAST_SOURCE"); deploying it would roll work back"; exit 1
fi
if [[ "$TREE" == "$PARENT_TREE" ]]; then
  echo "✓ nothing to deploy: $REMOTE/$BRANCH already matches $(git rev-parse --short HEAD)"; exit 0
fi

COUNT=$(git rev-list --count "$LAST_SOURCE..HEAD")
MESSAGE="Deploy: $(git log -1 --format=%s HEAD)

$COUNT commit(s) since the last deploy, as one snapshot of the local HAIT
checkout without its history.

Source-Commit: $SOURCE"
NEW=$(git commit-tree "$TREE" -p "$PARENT" -m "$MESSAGE")

echo "from $(git rev-parse --short "$LAST_SOURCE") to $(git rev-parse --short HEAD), $COUNT commit(s):"
git diff --stat "$PARENT" "$NEW" | tail -8

if [[ $DRY_RUN == 1 ]]; then
  echo "(dry run) would push $(git rev-parse --short "$NEW") to $REMOTE/$BRANCH"; exit 0
fi
git push "$REMOTE" "$NEW:refs/heads/$BRANCH"
echo "✓ deployed $(git rev-parse --short HEAD) → $REMOTE/$BRANCH $(git rev-parse --short "$NEW")"
