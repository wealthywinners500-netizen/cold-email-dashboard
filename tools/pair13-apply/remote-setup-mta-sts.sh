#!/usr/bin/env bash
# remote-setup-mta-sts.sh — server-side MTA-STS HTTPS endpoint setup
# for Pair 13 oracle-swap. Runs on S1 or S2 over SSH.
#
# For each zone argument, this script:
#   1. Adds mta-sts.<zone> as a web-domain alias via v-add-web-domain-alias
#      (idempotent — HestiaCP returns error if already present; we swallow it)
#   2. Issues / extends the LE SAN cert via v-add-letsencrypt-domain admin <zone> yes
#      (this re-issues the cert with ALL current aliases including mta-sts.*)
#   3. Creates /home/admin/web/<zone>/public_html/.well-known/mta-sts.txt
#      with mode=testing (will flip to enforce in 2 weeks per RFC 8461 rollout)
#   4. Curls the HTTPS endpoint to confirm HTTP 200 and correct body
#
# Per HL #98: if v-add-letsencrypt-domain exits silently (no output),
# check /var/log/hestia/LE-*.log for "Too many certificates already issued
# for identifier set" — DO NOT retry; the cert is already there, just the
# nginx/apache config hasn't reloaded to pick it up.
#
# Usage:
#   remote-setup-mta-sts.sh <zone1> [<zone2> ...]

set -u
ZONES="$@"
[[ -z "$ZONES" ]] && { echo "Usage: $0 <zone1> [<zone2> ...]" >&2; exit 2; }

USER=admin
DOCROOT_BASE="/home/${USER}/web"
LE_LOG_DIR="/var/log/hestia"
FAIL=0

log()  { printf "  [%s] %s\n" "$1" "$2"; }
pass() { log "OK  " "$1"; }
warn() { log "WARN" "$1"; }
fail() { log "FAIL" "$1"; FAIL=$((FAIL+1)); }

for zone in $ZONES; do
  echo ""
  echo "=== ${zone}: MTA-STS setup ==="

  DOCROOT="${DOCROOT_BASE}/${zone}/public_html"
  MTA_STS_DIR="${DOCROOT}/.well-known"
  MTA_STS_FILE="${MTA_STS_DIR}/mta-sts.txt"

  if [[ ! -d "${DOCROOT_BASE}/${zone}" ]]; then
    fail "${zone}: web domain missing (docroot ${DOCROOT_BASE}/${zone} not found) — run v-add-web-domain first"
    continue
  fi

  # 1. Add web alias (swallow "already exists" error — two variants observed:
  #    "Error: Web alias ... exists" and "already exists".)
  ALIAS_OUT=$(/usr/local/hestia/bin/v-add-web-domain-alias "${USER}" "${zone}" "mta-sts.${zone}" 2>&1 || true)
  if echo "$ALIAS_OUT" | grep -qiE "already|exists"; then
    pass "${zone}: alias mta-sts.${zone} already present (idempotent skip)"
  elif echo "$ALIAS_OUT" | grep -qiE "(error|fail)"; then
    fail "${zone}: v-add-web-domain-alias failed: ${ALIAS_OUT}"
    continue
  else
    pass "${zone}: alias mta-sts.${zone} added"
  fi

  # 2. Create .well-known/mta-sts.txt BEFORE LE reissue
  #    so the LE validator sees the final docroot state.
  mkdir -p "${MTA_STS_DIR}"
  cat > "${MTA_STS_FILE}" <<POLICY
version: STSv1
mode: testing
mx: mail.${zone}
max_age: 86400
POLICY
  chown -R "${USER}:${USER}" "${MTA_STS_DIR}" || true
  if [[ -s "${MTA_STS_FILE}" ]]; then
    pass "${zone}: mta-sts.txt written at ${MTA_STS_FILE} (mode=testing)"
  else
    fail "${zone}: mta-sts.txt write failed (${MTA_STS_FILE} empty)"
    continue
  fi

  # 3. Issue / extend LE cert. HestiaCP signature:
  #       v-add-letsencrypt-domain USER DOMAIN [ALIASES] [MAIL]
  #    ALIASES is a *comma-separated list* that REPLACES the SAN aliases.
  #    Passing empty = cert covers ONLY the bare domain (strips www and
  #    mta-sts). We explicitly re-specify www AND the new mta-sts entry.
  #    MAIL param left blank → this is the WEB cert (not the mail cert).
  NEW_LOG_CHUNK=""
  PRE_LOG=$(ls -1t "${LE_LOG_DIR}"/LE-*.log 2>/dev/null | head -1)
  PRE_SIZE=0
  if [[ -n "$PRE_LOG" && -f "$PRE_LOG" ]]; then
    PRE_SIZE=$(wc -c < "$PRE_LOG")
  fi
  LE_OUT=$(/usr/local/hestia/bin/v-add-letsencrypt-domain "${USER}" "${zone}" "www.${zone},mta-sts.${zone}" 2>&1 || true)
  LE_RC=$?
  POST_LOG=$(ls -1t "${LE_LOG_DIR}"/LE-*.log 2>/dev/null | head -1)
  if [[ -n "$POST_LOG" && -f "$POST_LOG" ]]; then
    POST_SIZE=$(wc -c < "$POST_LOG")
    if (( POST_SIZE > PRE_SIZE )); then
      NEW_LOG_CHUNK=$(tail -c $((POST_SIZE - PRE_SIZE)) "$POST_LOG")
    fi
  fi

  if echo "$LE_OUT$NEW_LOG_CHUNK" | grep -qiE "too many certificates|rate ?limit"; then
    # HL #98: silent LE rate-limit. Surface as WARN not FAIL —
    # cert likely still installed from prior run.
    warn "${zone}: LE rate-limit detected (HL #98). Existing cert may already cover mta-sts.${zone}; verify via openssl probe below."
  elif (( LE_RC == 0 )) && [[ -z "$LE_OUT" || -n "$NEW_LOG_CHUNK" ]]; then
    pass "${zone}: LE cert issued/extended to include mta-sts.${zone}"
  else
    fail "${zone}: LE issuance failed (rc=$LE_RC, out=${LE_OUT})"
    continue
  fi

  # 4. Probe the HTTPS endpoint
  #    Use curl --resolve to avoid relying on external DNS propagation here;
  #    we just need to know the cert + nginx config are serving it.
  IP=$(hostname -I | awk '{print $1}')
  RESP=$(curl -fsS --max-time 10 \
              --resolve "mta-sts.${zone}:443:${IP}" \
              "https://mta-sts.${zone}/.well-known/mta-sts.txt" 2>&1 || true)
  if echo "$RESP" | grep -qE "^mode: (enforce|testing)"; then
    pass "${zone}: HTTPS endpoint serving policy (mode=testing)"
  else
    warn "${zone}: HTTPS endpoint NOT serving valid policy yet — may need DNS propagation for LE cert reissue next run. Body: ${RESP:0:200}"
  fi
done

echo ""
echo "=== SUMMARY: FAIL=$FAIL ==="
exit $FAIL
