#!/usr/bin/env bash
# ONE bounded run; systemd timer schedules the next. Dedicated VM user only.
set -Eeuo pipefail
umask 077
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  nvm use --silent 24 >/dev/null 2>&1 || true
fi
ROOT="$HOME/NodeDesk"
STATE="$HOME/.local/state/nodedesk-autodev"
BRANCH="feat/post-v0.9-roadmap"
mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock -n 9 || exit 0
[[ ! -f "$STATE/PAUSE" ]] || exit 0
ID="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$STATE/run-$ID.log"
exec > >(tee -a "$LOG") 2>&1
pause() { echo "$1" > "$STATE/PAUSE"; echo "PAUSED: $1"; exit 1; }
cd "$ROOT" || pause "Repository missing at $ROOT"
[[ "$(git branch --show-current)" == "$BRANCH" ]] || pause "Unexpected branch"
case "$(git remote get-url origin)" in
  git@github.com:RYLE-307/NodeDesk.git|https://github.com/RYLE-307/NodeDesk.git) ;;
  *) pause "Untrusted git origin" ;;
esac
command -v codex >/dev/null || pause "Install Codex CLI"
command -v jq >/dev/null || pause "Install jq"
codex login status >/dev/null 2>&1 || pause "Run codex login --device-auth as this user"
if [[ -f "$STATE/cooldown" ]] && [[ "$(date +%s)" -lt "$(cat "$STATE/cooldown")" ]]; then
  echo "Quota cooldown in effect"
  exit 0
fi
git fetch --quiet origin "$BRANCH" || { echo "Git fetch failed"; exit 1; }
if git merge-base --is-ancestor HEAD "origin/$BRANCH"; then
  if [[ -z "$(git status --porcelain)" ]]; then
    git merge --ff-only --quiet "origin/$BRANCH"
  fi
elif ! git merge-base --is-ancestor "origin/$BRANCH" HEAD; then
  pause "Remote branch diverged; no reset or force push"
fi
BEFORE="$(git rev-parse HEAD)"
PREVIOUS="$(cat "$STATE/fingerprint" 2>/dev/null || true)"
PROMPT="$STATE/prompt-$ID.txt"
SUMMARY="$STATE/summary-$ID.txt"
cat "$ROOT/ops/autodev/MISSION.md" > "$PROMPT"
printf '\nRepository HEAD: %s\nRead CI on GitHub for this exact SHA and fix failures first. Implement code this run.\n' "$BEFORE" >> "$PROMPT"
echo "Starting Codex; timeout 75min; one run only."
set +e
timeout --signal=INT --kill-after=120s 75m \
  codex exec --approve-for-me -C "$ROOT" \
  --output-last-message "$SUMMARY" - < "$PROMPT"
RC=$?
set -e
echo "Codex status: $RC"
if grep -Eiq 'rate.?limit|insufficient.quota|usage.limit|429' "$LOG"; then
  date -d '+4 hours' +%s > "$STATE/cooldown"
  echo "Rate limit detected; backing off 4h"
fi
[[ "$(git branch --show-current)" == "$BRANCH" ]] ||
  pause "Agent changed branch; inspect manually"
AFTER="$(git rev-parse HEAD)"
FINGERPRINT="$( { git rev-parse HEAD; git status --porcelain; git diff --stat; } | sha256sum | cut -d' ' -f1)"
echo "$FINGERPRINT" > "$STATE/fingerprint"
if [[ "$FINGERPRINT" == "$PREVIOUS" ]]; then
  COUNT="$(cat "$STATE/stalled" 2>/dev/null || echo 0)"
  COUNT="$((COUNT+1))"
  echo "$COUNT" > "$STATE/stalled"
  [[ "$COUNT" -lt 5 ]] || pause "Five cycles with no repository progress; inspect logs"
else
  echo 0 > "$STATE/stalled"
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Uncommitted changes preserved for next cycle; NOT pushed"
  exit 0
fi
[[ "$BEFORE" != "$AFTER" ]] || { echo "No new commit"; exit 0; }
git merge-base --is-ancestor "origin/$BRANCH" HEAD ||
  pause "Remote no longer ancestor, no force push"
if git diff --name-only "origin/$BRANCH"..HEAD |
  grep -E '(^|/)(\.env($|\.)|auth\.json$|id_(rsa|ed25519)$|[^/]+\.(pem|p12|pfx|key)$)'; then
  pause "Suspicious credential file in commit; push blocked"
fi
if [[ ! -d node_modules ]]; then
  echo "npm dependencies not installed; no automatic push"
  exit 1
fi
npm test || { echo "Tests failed; committed code retained locally"; exit 1; }
npm run build || { echo "Build failed; committed code retained locally"; exit 1; }
if [[ "$(printenv NODEDESK_AUTOPUSH || true)" != "1" ]]; then
  echo "Auto-push off; commits retained locally"
  exit 0
fi
git push origin "HEAD:refs/heads/$BRANCH"
echo "Branch pushed; GitHub Actions checks actual commit"
find "$STATE" -maxdepth 1 -type f -name 'run-*.log' -mtime +21 -delete
