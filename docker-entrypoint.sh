#!/bin/sh
set -e
# A public deployment without an admin password would expose every scan, report and setting.
if [ -z "$QA_ADMIN_PASSWORD" ] && [ "$QA_ALLOW_NO_PASSWORD" != "1" ]; then
  echo "ERROR: QA_ADMIN_PASSWORD is not set. Set it in your host's environment variables." >&2
  echo "(Set QA_ALLOW_NO_PASSWORD=1 only for a private network.)" >&2
  exit 1
fi
mkdir -p "${QA_DATA_DIR:-/data}"
if [ -z "$QA_SECRET_KEY" ]; then
  echo "WARNING: QA_SECRET_KEY is not set; using a key generated in ${QA_DATA_DIR:-/data}/.secret-key. Keep that volume." >&2
fi
exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
