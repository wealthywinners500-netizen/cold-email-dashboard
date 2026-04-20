#!/usr/bin/env bash
# remote-apply-dns-v2.sh — HestiaCP-idiomatic DNS apply for Pair 13 oracle-swap.
#
# HARD RULE (HL-new): do NOT edit /home/admin/conf/dns/*.db directly. Any
# HestiaCP CLI call (v-add-letsencrypt-domain, v-add-web-domain, even unrelated
# ones) can trigger v-rebuild-dns-domain, which regenerates the zone file from
# HestiaCP metadata + template and WIPES direct edits. Use v-add-dns-record /
# v-delete-dns-record ONLY — these update metadata + zone file atomically.
#
# Per-zone operations (all idempotent, readback-verified):
#   1. DELETE + ADD _dmarc TXT (replace with full policy)
#   2. DELETE + ADD _mta-sts TXT (bump id to today's UTC timestamp)
#   3. ADD _smtp._tls TXT (TLS-RPT — skip if any v=TLSRPTv1 already present)
#   4. ADD mta-sts A <server-ip> (skip if already correct)
#   5. ADD CAA 0 issue "letsencrypt.org" (skip if present)
#   6. ADD CAA 0 issuewild ";" (skip if present)
#   7. ADD CAA 0 iodef "mailto:security@launta.info" (skip if present)
#
# Each v-add-dns-record is followed by a v-list-dns-records readback grep.
# Zone aborts on any mismatch.
#
# Does NOT call v-add-letsencrypt-domain. LE cert extension with mta-sts.<zone>
# SAN is deferred to a separate per-zone pass once DNS is durable.
#
# Usage: remote-apply-dns-v2.sh <server_ip> <zone1> [<zone2> ...]

set -u
IP="${1:?server_ip required}"; shift
ZONES="$@"

H=/usr/local/hestia/bin
USER_H=admin
NS_DOMAIN=launta.info
TTL=3600
MTA_STS_ID="$(date -u +%Y%m%d%H%M%S)"
# DMARC canonical value — MINIMAL (no rua/ruf/fo).
# HL-new 2026-04-20: cold-email sending infrastructure should omit rua/ruf/fo.
# Aggregate reports add near-zero operational value over Google Postmaster +
# mail-tester, and they require 10+ external-authorization TXT records when
# reporters are on foreign domains. Keeping DMARC minimal eliminates the
# "External Domains not giving permission" error at the source instead of
# papering over it with 10 authorization records.
DMARC_VALUE="v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; pct=100"
TLSRPT_VALUE="v=TLSRPTv1; rua=mailto:tlsrpt@${NS_DOMAIN}"
MTASTS_TXT_VALUE="v=STSv1; id=${MTA_STS_ID}"

log(){ printf "  [%s] %s\n" "$1" "$2"; }
pass(){ log "OK  " "$1"; }
warn(){ log "WARN" "$1"; }
fail(){ log "FAIL" "$1"; ZONE_RC=2; }

# list_ids ZONE RECORDNAME RECORDTYPE  →  echoes ID per matching row (one per line)
list_ids() {
  local z=$1 n=$2 t=$3
  $H/v-list-dns-records "$USER_H" "$z" plain 2>/dev/null | awk -v n="$n" -v t="$t" '$2==n && $3==t {print $1}'
}

# has_record ZONE RECORDNAME RECORDTYPE GREP_PATTERN  →  exit 0 if a matching row's value contains pattern
has_record() {
  local z=$1 n=$2 t=$3 pat=$4
  $H/v-list-dns-records "$USER_H" "$z" plain 2>/dev/null \
    | awk -v n="$n" -v t="$t" '$2==n && $3==t' \
    | grep -qF -- "$pat"
}

# add_record_verified ZONE RECORDNAME RECORDTYPE VALUE VERIFY_PATTERN
add_record_verified() {
  local z=$1 n=$2 t=$3 v=$4 vp=$5
  # RESTART=yes triggers per-zone rndc reload via HestiaCP's restart-dns-service.
  $H/v-add-dns-record "$USER_H" "$z" "$n" "$t" "$v" "" "" yes "$TTL" >/dev/null 2>&1
  if has_record "$z" "$n" "$t" "$vp"; then
    return 0
  else
    return 1
  fi
}

# delete_records_by_name_type ZONE NAME TYPE
delete_records_by_name_type() {
  local z=$1 n=$2 t=$3
  local deleted=0
  for id in $(list_ids "$z" "$n" "$t"); do
    if $H/v-delete-dns-record "$USER_H" "$z" "$id" no >/dev/null 2>&1; then
      deleted=$((deleted+1))
    fi
  done
  echo "$deleted"
}

OVERALL_RC=0

for zone in $ZONES; do
  echo ""
  echo "=== $zone ==="
  ZONE_RC=0

  # -------- 1. _dmarc TXT (replace with MINIMAL value, no rua/ruf) --------
  del=$(delete_records_by_name_type "$zone" "_dmarc" TXT)
  [[ "$del" -gt 0 ]] && pass "$zone: deleted $del prior _dmarc TXT record(s)"
  if add_record_verified "$zone" "_dmarc" TXT "$DMARC_VALUE" "sp=quarantine"; then
    # Belt-and-suspenders: confirm no rua/ruf accidentally survived in the stored value.
    if has_record "$zone" "_dmarc" TXT "rua=" || has_record "$zone" "_dmarc" TXT "ruf="; then
      fail "$zone: _dmarc readback still contains rua= or ruf= — stale record not cleanly replaced"
      (( ZONE_RC != 0 )) && OVERALL_RC=2 && continue
    fi
    pass "$zone: _dmarc TXT replaced with minimal policy (no rua/ruf/fo)"
  else
    fail "$zone: _dmarc TXT add failed or readback didn't show sp=quarantine"
    (( ZONE_RC != 0 )) && OVERALL_RC=2 && continue
  fi

  # -------- 2. _mta-sts TXT (only (re)write if missing or malformed) --------
  # RFC 8461: bump id ONLY when policy content changes. Since the HTTPS policy
  # is unchanged, avoid spurious id churn on re-run.
  if has_record "$zone" "_mta-sts" TXT "v=STSv1" && has_record "$zone" "_mta-sts" TXT "id="; then
    pass "$zone: _mta-sts TXT already valid v=STSv1 with id= (idempotent skip)"
  else
    del=$(delete_records_by_name_type "$zone" "_mta-sts" TXT)
    [[ "$del" -gt 0 ]] && pass "$zone: deleted $del prior _mta-sts TXT record(s)"
    if add_record_verified "$zone" "_mta-sts" TXT "$MTASTS_TXT_VALUE" "id=${MTA_STS_ID}"; then
      pass "$zone: _mta-sts TXT added (id=${MTA_STS_ID})"
    else
      fail "$zone: _mta-sts TXT add failed or readback didn't show id=${MTA_STS_ID}"
      (( ZONE_RC != 0 )) && OVERALL_RC=2 && continue
    fi
  fi

  # -------- 3. _smtp._tls TXT (TLS-RPT, add if missing) --------
  if has_record "$zone" "_smtp._tls" TXT "v=TLSRPTv1"; then
    pass "$zone: _smtp._tls TLS-RPT already present (idempotent skip)"
  else
    if add_record_verified "$zone" "_smtp._tls" TXT "$TLSRPT_VALUE" "v=TLSRPTv1"; then
      pass "$zone: _smtp._tls TXT added"
    else
      fail "$zone: _smtp._tls TXT add failed or readback missing v=TLSRPTv1"
      (( ZONE_RC != 0 )) && OVERALL_RC=2 && continue
    fi
  fi

  # -------- 4. mta-sts A record (to owning server) --------
  existing_mtasts_ip=$($H/v-list-dns-records "$USER_H" "$zone" plain 2>/dev/null \
                       | awk '$2=="mta-sts" && $3=="A" {print $4; exit}')
  if [[ "$existing_mtasts_ip" == "$IP" ]]; then
    pass "$zone: mta-sts A already → $IP (idempotent skip)"
  elif [[ -n "$existing_mtasts_ip" ]]; then
    warn "$zone: mta-sts A is $existing_mtasts_ip (expected $IP) — leaving untouched, manual inspection needed"
  else
    if add_record_verified "$zone" "mta-sts" A "$IP" "$IP"; then
      pass "$zone: mta-sts A → $IP added"
    else
      fail "$zone: mta-sts A add failed"
      (( ZONE_RC != 0 )) && OVERALL_RC=2 && continue
    fi
  fi

  # -------- 5. CAA issue letsencrypt.org (add if missing) --------
  if has_record "$zone" "@" CAA 'issue "letsencrypt.org"'; then
    pass "$zone: CAA 0 issue \"letsencrypt.org\" already present"
  else
    if add_record_verified "$zone" "@" CAA '0 issue "letsencrypt.org"' 'letsencrypt.org'; then
      pass "$zone: CAA 0 issue \"letsencrypt.org\" added"
    else
      fail "$zone: CAA issue letsencrypt.org add failed"
      (( ZONE_RC != 0 )) && OVERALL_RC=2 && continue
    fi
  fi

  # -------- 6. CAA 0 issuewild ";" --------
  if has_record "$zone" "@" CAA 'issuewild'; then
    pass "$zone: CAA 0 issuewild \";\" already present"
  else
    if add_record_verified "$zone" "@" CAA '0 issuewild ";"' 'issuewild'; then
      pass "$zone: CAA 0 issuewild \";\" added"
    else
      fail "$zone: CAA issuewild add failed"
      (( ZONE_RC != 0 )) && OVERALL_RC=2 && continue
    fi
  fi

  # -------- 7. CAA 0 iodef --------
  if has_record "$zone" "@" CAA 'iodef'; then
    pass "$zone: CAA 0 iodef already present"
  else
    if add_record_verified "$zone" "@" CAA "0 iodef \"mailto:security@${NS_DOMAIN}\"" 'iodef'; then
      pass "$zone: CAA 0 iodef \"mailto:security@${NS_DOMAIN}\" added"
    else
      fail "$zone: CAA iodef add failed"
      (( ZONE_RC != 0 )) && OVERALL_RC=2 && continue
    fi
  fi

  if (( ZONE_RC == 0 )); then
    pass "$zone: ALL RECORDS VERIFIED"
  fi
done

echo ""
echo "=== OVERALL RC=$OVERALL_RC ==="
exit $OVERALL_RC
