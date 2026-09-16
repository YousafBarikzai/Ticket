#!/usr/bin/env bash
# Creates the four database roles and the databases they use.
#
# The roles are not a convenience: row-level security distinguishes the
# application role from the platform role from the owner, and a test run that
# used one role for everything would prove nothing about isolation.
set -euo pipefail

# Which databases to prepare. The default pair is what a developer and CI need;
# a deployed environment passes its own single name (`DATABASES=itsm` on the
# staging and production runs), because a production cluster with an `itsm_test`
# database on it is an invitation nobody should have to decline.
DATABASES="${DATABASES:-itsm_dev itsm_test}"

# One password per role, falling back to a shared one.
#
# The fallback is for local work and CI, where all four roles live in a
# throwaway container and four secrets would be four ways to mistype `devpass`.
# A deployed environment sets them individually, and that is the whole reason
# the roles are separate: `app_user` is subject to row-level security and
# `app_owner` owns the tables, so an `app_user` credential that also opened a
# session as `app_owner` would make the isolation in doc 10 decorative.
PASSWORD="${APP_PASSWORD:-devpass}"
OWNER_PASSWORD="${APP_OWNER_PASSWORD:-$PASSWORD}"
USER_PASSWORD="${APP_USER_PASSWORD:-$PASSWORD}"
PLATFORM_PASSWORD="${APP_PLATFORM_PASSWORD:-$PASSWORD}"
READONLY_PASSWORD="${APP_READONLY_PASSWORD:-$PASSWORD}"

# A refusal rather than a warning: a deployed environment that silently accepted
# `devpass` for four roles would be a database anybody who has read this
# repository can open. `ENVIRONMENT` is set by the deploy workflow; unset means
# somebody's laptop.
if [ "${ENVIRONMENT:-local}" != "local" ] && [ "${ALLOW_SHARED_PASSWORD:-no}" != "yes" ]; then
  for name in OWNER_PASSWORD USER_PASSWORD PLATFORM_PASSWORD READONLY_PASSWORD; do
    eval "value=\$$name"
    if [ "${value}" = "devpass" ]; then
      echo "refusing to prepare ${ENVIRONMENT}: ${name} is still the development default" >&2
      exit 1
    fi
  done
fi

psql -v ON_ERROR_STOP=1 -d postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    CREATE ROLE app_owner LOGIN PASSWORD '${OWNER_PASSWORD}' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD '${USER_PASSWORD}' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform LOGIN PASSWORD '${PLATFORM_PASSWORD}' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly LOGIN PASSWORD '${READONLY_PASSWORD}' NOBYPASSRLS;
  END IF;
END
\$\$;
SQL

for db in ${DATABASES}; do
  if ! psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'" | grep -q 1; then
    psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE ${db} OWNER app_owner"
  fi
  psql -v ON_ERROR_STOP=1 -d "${db}" -c "
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS btree_gin;"
done

echo "roles and databases ready: ${DATABASES}"
