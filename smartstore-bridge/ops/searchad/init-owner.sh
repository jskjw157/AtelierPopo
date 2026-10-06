#!/bin/sh
# Runs only on an empty, dedicated volume; never source with shell tracing enabled.
set -eu
export SEARCHAD_OWNER_PASSWORD="$(cat /run/secrets/searchad_owner_password)"
export PGPASSWORD="$POSTGRES_PASSWORD"
psql --no-psqlrc --no-password --set=ON_ERROR_STOP=1 \
  --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" <<'SQL'
\getenv owner_password SEARCHAD_OWNER_PASSWORD
CREATE ROLE searchad_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'owner_password';
ALTER DATABASE searchad OWNER TO searchad_owner;
REVOKE ALL ON DATABASE searchad FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO searchad_owner;
SQL
unset SEARCHAD_OWNER_PASSWORD PGPASSWORD
