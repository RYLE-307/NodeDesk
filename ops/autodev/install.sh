#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd "$HOME/NodeDesk"
[[ "$(git branch --show-current)" == "feat/post-v0.9-roadmap" ]] ||
  { echo "Checkout expected NodeDesk feature branch first"; exit 1; }
for cmd in git flock jq curl codex systemctl; do
  command -v "$cmd" >/dev/null || { echo "Missing $cmd"; exit 1; }
done
codex login status
mkdir -p "$HOME/.local/bin" "$HOME/.config/systemd/user" \
  "$HOME/.local/state/nodedesk-autodev"
install -m 0750 ops/autodev/runner.sh "$HOME/.local/bin/nodedesk-autodev-runner"
install -m 0644 ops/autodev/nodedesk-autodev.service \
  "$HOME/.config/systemd/user/nodedesk-autodev.service"
install -m 0644 ops/autodev/nodedesk-autodev.timer \
  "$HOME/.config/systemd/user/nodedesk-autodev.timer"
systemctl --user daemon-reload
systemctl --user enable --now nodedesk-autodev.timer
echo "Timer enabled. Auto-push is OFF until restricted repo key is configured."
