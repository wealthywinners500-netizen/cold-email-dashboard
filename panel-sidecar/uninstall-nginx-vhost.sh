#!/bin/bash
# Remove nginx.ssl.conf_sidecar from the panel-hostname vhost dir, validate, reload.
# Usage:  bash uninstall-nginx-vhost.sh <panel-hostname>
set -euo pipefail

HOST="${1:-}"
if [[ -z "$HOST" ]]; then
  echo "usage: $0 <panel-hostname>" >&2
  exit 2
fi

TARGET="/home/admin/conf/web/${HOST}/nginx.ssl.conf_sidecar"

if [[ -f "$TARGET" ]]; then
  rm -f "$TARGET"
  echo "[uninstall] removed: $TARGET"
else
  echo "[uninstall] already absent: $TARGET"
fi

nginx -t 2>&1
echo "[uninstall] nginx -t OK; reloading"
systemctl reload nginx
echo "[uninstall] DONE"
