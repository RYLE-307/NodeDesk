#!/usr/bin/env bash
set -euo pipefail
# Isolated local server. Nothing touches the user's ~/.ssh or known_hosts.
fixture=$(mktemp -d)
server_pid=""
auth_user="ndfixture$$"
cleanup() {
  if [[ -n "$server_pid" ]]; then sudo kill "$server_pid" 2>/dev/null || true; fi
  sudo userdel "$auth_user" 2>/dev/null || true
  # PAM may create private cache files owned by the disposable account.
  # Delete only the exact directory created by mktemp, never a computed parent.
  if [[ "$fixture" == /tmp/tmp.* && -d "$fixture" && ! -L "$fixture" ]]; then
    sudo rm -rf -- "$fixture"
  fi
}
trap cleanup EXIT
# Disposable CI account; never alters a developer account or uses user credentials.
# Secret travels to chpasswd on stdin and is read only by the isolated Rust test.
umask 077
openssl rand -hex 24 | tr -d '\n' > "$fixture/auth-secret"
printf '%s' "$auth_user" > "$fixture/auth-user"
sudo useradd -M -d "$fixture/auth-home" -s /bin/sh "$auth_user"
{ printf '%s:' "$auth_user"; cat "$fixture/auth-secret"; printf '\n'; } | sudo chpasswd
chmod 711 "$fixture"
sudo mkdir "$fixture/auth-home"
sudo chown "$auth_user" "$fixture/auth-home"
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
PasswordAuthentication yes
KbdInteractiveAuthentication yes
UsePAM yes
AllowUsers $(id -un) $auth_user
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
filename='binary пробел ;$(x).bin'
cmp "$fixture/gui-local/$filename" "$fixture/gui-local/download.bin"
cmp "$fixture/gui-local/$filename" "$fixture/gui-remote/$filename"
sha256sum "$fixture/gui-local/$filename" "$fixture/gui-local/download.bin" "$fixture/gui-remote/$filename"
