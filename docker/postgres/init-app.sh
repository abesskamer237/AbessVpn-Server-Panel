#!/bin/sh
set -eu
# The API never receives the PostgreSQL superuser password.
: "${POSTGRES_APP_PASSWORD:?Persistent application password required}"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE abess_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='abess_app') \gexec
GRANT CONNECT ON DATABASE abess TO abess_app;
GRANT USAGE, CREATE ON SCHEMA public TO abess_app;
SQL
