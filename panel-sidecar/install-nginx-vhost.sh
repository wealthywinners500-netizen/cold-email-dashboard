#!/bin/bash
# Drop nginx.ssl.conf_sidecar into the panel-hostname vhost dir, validate, reload.
# Usage:  bash install-nginx-vhost.sh <panel-hostname>
# Example: bash install-nginx-vhost.sh mail1.krogermedianetwork.info
set -euo pipefail

HOST="${1:-}"
if [[ -z "$HOST" ]]; then
  echo "usage: $0 <panel-hostname>" >&2
  exit 2
fi

VHOST_DIR="/home/admin/conf/web/${HOST}"
TARGET="${VHOST_DIR}/nginx.ssl.conf_sidecar"
SOURCE_DIR="$(dirname "$(readlink -f "$0")")"
SOURCE="${SOURCE_DIR}/nginx.ssl.conf_sidecar"

if [[ ! -d "$VHOST_DIR" ]]; then
  echo "ERROR: vhost dir missing: $VHOST_DIR" >&2
  exit 3
fi
if [[ ! -f "$SOURCE" ]]; then
  echo "ERROR: source missing: $SOURCE" >&2
  exit 3
fi

cp -f "$SOURCE" "$TARGET"
chown root:admin "$TARGET"
chmod 0640 "$TARGET"

echo "[install] dropped: $TARGET"
nginx -t 2>&1
echo "[install] nginx -t OK; reloading"
systemctl reload nginx
echo "[install] DONE"
