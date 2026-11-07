#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
mkdir -p generated
if [[ -e generated/vnc-password ]]; then
  echo 'Existing disposable password retained. Use docker compose down -v before resetting.'
  exit 0
fi
python3 - <<'PY'
from pathlib import Path
import secrets
import string
alphabet = string.ascii_letters + string.digits
# Classic VNC authentication uses only the first eight password bytes.
Path('generated/vnc-password').write_text(''.join(secrets.choice(alphabet) for _ in range(8)) + '\n')
PY
echo 'Generated an ignored, disposable VNC password.'
