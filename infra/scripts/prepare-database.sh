#!/usr/bin/env bash
# Creates the four database roles and the databases they use.
#
# The roles are not a convenience: row-level security distinguishes the
# application role from the platform role from the owner, and a test run that
# used one role for everything would prove nothing about isolation.
set -euo pipefail

DB_DEV="${DB_DEV:-itsm_dev}"
DB_TEST="${DB_TEST:-itsm_test}"
PASSWORD="${APP_PASSWORD:-devpass}"

psql -v ON_ERROR_STOP=1 -d postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    CREATE ROLE app_owner LOGIN PASSWORD '${PASSWORD}' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD '${PASSWORD}' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform LOGIN PASSWORD '${PASSWORD}' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly LOGIN PASSWORD '${PASSWORD}' NOBYPASSRLS;
  END IF;
END
\$\$;
SQL

for db in "${DB_DEV}" "${DB_TEST}"; do
  if ! psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'" | grep -q 1; then
    psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE ${db} OWNER app_owner"
  fi
  psql -v ON_ERROR_STOP=1 -d "${db}" -c "
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS btree_gin;"
done

echo "roles and databases ready: ${DB_DEV}, ${DB_TEST}"
