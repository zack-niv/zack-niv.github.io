#!/bin/bash
# Deploy the Lost in Namba demo to GitHub Pages: copies runtime files to main:/namba-demo/ and pushes main.
#   bash namba-demo/tools/deploy.sh "Deploy Lost in Namba vX: what changed"
# Pre-approved by Zack for /namba-demo/ only. Never touch other paths on main.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
SRC=$REPO/namba-demo
DST=$(mktemp -d)/site-main
git -C "$REPO" fetch -q origin main
git -C "$REPO" worktree add -q --detach "$DST" origin/main
trap 'git -C "$REPO" worktree remove --force "$DST" >/dev/null 2>&1 || true' EXIT
rm -rf "$DST/namba-demo" && mkdir -p "$DST/namba-demo"
cp -r "$SRC/index.html" "$SRC/og.jpg" "$SRC/css" "$SRC/js" "$SRC/vendor" "$SRC/assets" "$DST/namba-demo/"
rm -rf "$DST"/namba-demo/assets/*/tools
find "$DST/namba-demo" -name '*.md' ! -name 'LICENSE.md' -delete
# cache-busting: every module/CSS URL gets ?v=<source sha> so browsers never mix old and new files after a deploy
STAMP=$(git -C "$REPO" rev-parse --short HEAD)$( [ -n "$(git -C "$REPO" status --porcelain -- namba-demo/js namba-demo/css namba-demo/index.html)" ] && echo "-dirty$(date +%s)" )
node "$SRC/tools/stamp.mjs" "$DST/namba-demo" "$STAMP"
du -sh "$DST/namba-demo"
git -C "$DST" add -A namba-demo
git -C "$DST" commit -q -m "${1:-Deploy Lost in Namba demo}" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
for d in 2 4 8 16 0; do git -C "$DST" push -q origin HEAD:main && break; [ $d = 0 ] && exit 1; sleep $d; done
git -C "$DST" log --oneline -1
# Verify (Pages takes ~1-2 min): compare a few live files' sha1 with the local ones, e.g.
#   curl -s https://zack-niv.github.io/namba-demo/js/main.js | sha1sum ; sha1sum < namba-demo/js/main.js
