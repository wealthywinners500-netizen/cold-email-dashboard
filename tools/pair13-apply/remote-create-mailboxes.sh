#!/usr/bin/env bash
# remote-create-mailboxes.sh — create the DMARC/TLS-RPT reporting mailboxes
# on launta.info (the NS domain). Runs on S1 only (launta.info primary).
#
# Mailboxes:
#   dmarc-rua@launta.info   → DMARC aggregate reports
#   dmarc-ruf@launta.info   → DMARC forensic reports
#   tlsrpt@launta.info      → MTA-STS/TLS-RPT reports
#
# Idempotent — checks for existence before create.

set -u
USER=admin
ZONE=launta.info
MAILBOXES=(dmarc-rua dmarc-ruf tlsrpt)
FAIL=0

log()  { printf "  [%s] %s\n" "$1" "$2"; }
pass() { log "OK  " "$1"; }
warn() { log "WARN" "$1"; }
fail() { log "FAIL" "$1"; FAIL=$((FAIL+1)); }

# Verify the zone exists first
if ! /usr/local/hestia/bin/v-list-mail-domain "${USER}" "${ZONE}" >/dev/null 2>&1; then
  echo "ERROR: mail domain ${ZONE} not registered with HestiaCP on this server" >&2
  exit 3
fi

EXISTING=$(/usr/local/hestia/bin/v-list-mail-accounts "${USER}" "${ZONE}" plain 2>/dev/null | awk '{print $1}')

for mb in "${MAILBOXES[@]}"; do
  if echo "$EXISTING" | grep -qw "$mb"; then
    pass "$mb@${ZONE}: already exists"
    continue
  fi

  # Random 24-char password (alphanumeric + limited specials)
  PWD=$(LC_ALL=C tr -dc 'A-Za-z0-9_!#%' </dev/urandom | head -c 24)
  OUT=$(/usr/local/hestia/bin/v-add-mail-account "${USER}" "${ZONE}" "$mb" "$PWD" 2>&1)
  if [[ $? -eq 0 ]]; then
    pass "$mb@${ZONE}: created"
    # NOTE: we DO NOT print the password — leave no trace in ssh output.
    # Dean can reset it via the Hestia panel if ever needed.
  else
    fail "$mb@${ZONE}: v-add-mail-account failed: $OUT"
  fi
done

echo ""
echo "=== MAILBOXES: FAIL=$FAIL ==="
exit $FAIL
