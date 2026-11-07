#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")"

command -v docker >/dev/null || { echo "Docker is required" >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required" >&2; exit 1; }

if [[ -e .env || -e generated/init/01-schema.sql ]]; then
  echo "Lab has already been prepared; not overwriting existing credentials or database."
  echo "To reset use docker compose down -v, then remove .env and generated/ manually."
  exit 0
fi

mkdir -p generated/init
echo "Extracting the official Apache Guacamole 1.6.0 PostgreSQL schema..."
docker run --rm guacamole/guacamole:1.6.0 \
  /opt/guacamole/bin/initdb.sh --postgresql > generated/init/01-schema.sql
test -s generated/init/01-schema.sql || { echo "Empty PostgreSQL schema" >&2; exit 1; }

python3 - <<'PY'
from pathlib import Path
from secrets import token_urlsafe, token_bytes
from hashlib import sha256

def pw_hash(password):
    salt=token_bytes(32)
    # PostgreSQL 1.6.0 bundled admin user uses SHA256(password + UPPER(hex(salt))).
    digest=sha256((password+salt.hex().upper()).encode("utf-8")).hexdigest().upper()
    return digest, salt.hex().upper()

def sql(value):
    return "'" + value.replace("'", "''") + "'"

db_password=token_urlsafe(28)
admin_password=token_urlsafe(28)
qa_password=token_urlsafe(28)
rdp_password=token_urlsafe(28)
qa_user="nodedeskqa"
admin_hash,admin_salt=pw_hash(admin_password)
qa_hash,qa_salt=pw_hash(qa_password)

env=(
    "GUAC_DB_PASSWORD="+db_password+"\n"
    "GUAC_ADMIN_PASSWORD="+admin_password+"\n"
    "QA_USER="+qa_user+"\n"
    "QA_PASSWORD="+qa_password+"\n"
    "QA_RDP_USER="+qa_user+"\n"
    "QA_RDP_PASSWORD="+rdp_password+"\n"
    "NODEDESK_ORIGIN=http://127.0.0.1:1420\n"
)
Path(".env").write_text(env)
Path(".env").chmod(0o600)

fixture=f"""
-- Disposable NodeDesk lab only; never use these settings for production.
-- Replace the predictable Guacamole default admin login before exposure.
UPDATE guacamole_user SET
  password_hash=decode({sql(admin_hash)},'hex'),
  password_salt=decode({sql(admin_salt)},'hex'),
  password_date=CURRENT_TIMESTAMP
WHERE entity_id=(SELECT entity_id FROM guacamole_entity
  WHERE name='guacadmin' AND type='USER');

INSERT INTO guacamole_entity (name,type) VALUES ('nodedeskqa','USER');
INSERT INTO guacamole_user (entity_id,password_hash,password_salt,password_date)
SELECT entity_id,decode({sql(qa_hash)},'hex'),decode({sql(qa_salt)},'hex'),CURRENT_TIMESTAMP
FROM guacamole_entity WHERE name='nodedeskqa' AND type='USER';

INSERT INTO guacamole_connection (connection_name, protocol)
VALUES ('NodeDesk QA xrdp','rdp');

INSERT INTO guacamole_connection_parameter
(connection_id,parameter_name,parameter_value)
SELECT c.connection_id, p.name,p.value
FROM guacamole_connection c
CROSS JOIN (VALUES
  ('hostname','rdp'),('port','3389'),
  ('username',{sql(qa_user)}),('password',{sql(rdp_password)}),
  ('security','any'),('ignore-cert','true'),
  ('disable-copy','true'),('disable-paste','true')
) AS p(name,value)
WHERE c.connection_name='NodeDesk QA xrdp' AND c.protocol='rdp';

INSERT INTO guacamole_connection_permission (entity_id,connection_id,permission)
SELECT e.entity_id,c.connection_id,'READ'
FROM guacamole_entity e, guacamole_connection c
WHERE e.name='nodedeskqa' AND e.type='USER'
  AND c.connection_name='NodeDesk QA xrdp';
"""
Path("generated/init/02-fixture.sql").write_text(fixture)
Path("generated/init/02-fixture.sql").chmod(0o600)
print("Generated disposable, independent Guacamole admin/user, DB and xrdp credentials.")
print("The resulting .env and SQL contain secrets and must never be committed.")
PY

echo "Prepared. Start with: docker compose up -d"
echo "Review Caddy's internal CA trust instructions in README.md before connecting."
