#!/usr/bin/env bash
set -euo pipefail
# Isolated local server. Nothing touches the user's ~/.ssh or known_hosts.
fixture=$(mktemp -d)
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then sudo kill "$server_pid" 2>/dev/null || true; fi
  rm -rf -- "$fixture"
}
trap cleanup EXIT
ssh-keygen -q -t ed25519 -N '' -f "$fixture/host"
ssh-keygen -q -t ed25519 -N '' -f "$fixture/other"
ssh-keygen -q -t ed25519 -N '' -f "$fixture/client"
printf '[127.0.0.1]:22229 %s\n' "$(cat "$fixture/other.pub")" > "$fixture/changed"
printf '@revoked [127.0.0.1]:22229 %s\n' "$(cat "$fixture/host.pub")" > "$fixture/revoked"
printf '[127.0.0.1]:22229 %s\n' "$(cat "$fixture/host.pub")" > "$fixture/trusted-gui"
cat > "$fixture/sshd_config" <<EOF
ListenAddress 127.0.0.1
Port 22229
HostKey $fixture/host
PidFile $fixture/pid
AuthorizedKeysFile $fixture/client.pub
StrictModes no
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
AllowUsers $(id -un)
LogLevel VERBOSE
Subsystem sftp internal-sftp
EOF
sudo mkdir -p /run/sshd
sudo /usr/sbin/sshd -D -e -f "$fixture/sshd_config" &
server_pid=$!
for _ in {1..50}; do
  if ssh-keyscan -p 22229 127.0.0.1 >/dev/null 2>&1; then break; fi
  sleep 0.1
done
NODEDESK_SSH_FIXTURE="$fixture" cargo test --locked --manifest-path src-tauri/Cargo.toml -- --nocapture
