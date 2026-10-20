#!/bin/sh
# Run only inside the existing production Postgres container. Never exports a URL.
set -eu
if [ "${RESOLUTE_CHECK_STORAGE_WRITE:-}" != true ]; then
  printf '%s\n' '{"event":"RESOLUTE_SCOPED_ROLLBACK_DISABLED"}'
  exit 0
fi
if [ "${RAILWAY_SERVICE_ID:-}" != 69531581-732c-478b-afee-a971cf25ee4c ] ||
   [ "${RAILWAY_PROJECT_ID:-}" != 0872be15-db75-4e5a-ae0f-881911fb442d ] ||
   [ "${RAILWAY_ENVIRONMENT_ID:-}" != 3a80776d-15a3-4ca1-bd0c-e0c915ccf73b ]; then
  printf '%s\n' '{"event":"RESOLUTE_SCOPED_ROLLBACK_WRONG_CONTAINER"}' >&2
  exit 1
fi
if [ "$#" -ne 0 ]; then
  printf '%s\n' '{"event":"RESOLUTE_SCOPED_ROLLBACK_ARGUMENTS_FORBIDDEN"}' >&2
  exit 1
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Empty environment prevents PGHOSTADDR/PGSERVICE/PGOPTIONS overriding the local
# socket or transaction settings. No password is transferred or prompted for.
# ON_ERROR_STOP terminates psql on failure; disconnect rolls back an open tx.
exec env -i PATH="$PATH" PGCONNECT_TIMEOUT=5 psql -X --no-password \
  --set=ON_ERROR_STOP=1 --host=/var/run/postgresql --username=postgres \
  --dbname=resolute --file="$script_dir/check-storage-write.sql"
