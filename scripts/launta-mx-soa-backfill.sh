#!/usr/bin/env bash
# launta-mx-soa-backfill.sh — Session 04d Option B revert (HL #106 + #107).
#
# Reverts launta.info pair from Option A MX (mail{1|2}.{nsDomain}) back to
# per-domain MX (mail.{domain}). Also fixes SOA timer values to MXToolbox-safe
# RFC 1912 ranges: 3600 600 2419200 3600 (Refresh 1hr, Retry 10min, Expire 4wk,
# Minimum 1hr). HestiaCP factory defaults of 7200 3600 1209600 180 trigger
# MXToolbox "SOA Refresh Value out of recommended range" warnings.
#
# Runs MX rewrite + SOA timer fix on the PRIMARY server for each zone. AXFR
# propagates the change to the slave (NOTIFY is set via global named.conf.options
# — HL #105 — so it fires automatically).
#
# Usage:
#   SSH_PW_FILE=/tmp/.pw_s1s2_04d scripts/launta-mx-soa-backfill.sh

set -euo pipefail

S1_IP="${S1_IP:-69.164.213.37}"
S2_IP="${S2_IP:-50.116.14.26}"
SSH_PW_FILE="${SSH_PW_FILE:-/tmp/.pw_s1s2_04d}"
SSHPASS_BIN="${SSHPASS_BIN:-/opt/homebrew/bin/sshpass}"

S1_PRIMARY_ZONES=(launta.info caleap.info carena.info cereno.info cerone.info corina.info)
S2_PRIMARY_ZONES=(larena.info seamle.info seapot.info searely.info voility.info)

SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o PreferredAuthentications=password -o PubkeyAuthentication=no"

ssh_s1() { "$SSHPASS_BIN" -f "$SSH_PW_FILE" ssh $SSH_OPTS "root@${S1_IP}" "$@"; }
ssh_s2() { "$SSHPASS_BIN" -f "$SSH_PW_FILE" ssh $SSH_OPTS "root@${S2_IP}" "$@"; }

rewrite_mx_on_primary() {
  local host_fn="$1"; shift
  local zones=("$@")
  for zone in "${zones[@]}"; do
    echo "--- ${zone} ---"
    # Skip launta.info — NS domain doesn't need a MX rewrite (keep whatever)
    if [[ "$zone" == "launta.info" ]]; then
      echo "  NS domain: skipping MX rewrite"
      continue
    fi
    # Get all @ MX record IDs, delete them, then add mail.{zone}
    local record_ids
    record_ids=$($host_fn "/usr/local/hestia/bin/v-list-dns-records admin ${zone} plain | awk '\$2==\"@\" && \$3==\"MX\" {print \$1}'")
    for rid in $record_ids; do
      $host_fn "/usr/local/hestia/bin/v-delete-dns-record admin ${zone} ${rid}" >/dev/null 2>&1 || true
      echo "  deleted old MX record id ${rid}"
    done
    $host_fn "/usr/local/hestia/bin/v-add-dns-record admin ${zone} @ MX mail.${zone} 10" >/dev/null 2>&1 || true
    echo "  added @ MX mail.${zone} 10"
  done
}

fix_soa_on_primary() {
  local host_fn="$1"; shift
  local zones=("$@")
  for zone in "${zones[@]}"; do
    # Keep current MNAME (ns1.launta.info), set safe timers: 3600 600 2419200 3600
    $host_fn "/usr/local/hestia/bin/v-change-dns-domain-soa admin ${zone} ns1.launta.info '' 3600 600 2419200 3600" >/dev/null 2>&1 || true
    echo "  SOA timers set for ${zone}"
  done
}

echo "=== Rewrite @ MX → mail.{domain} on S1-primary zones ==="
rewrite_mx_on_primary ssh_s1 "${S1_PRIMARY_ZONES[@]}"
echo ""
echo "=== Rewrite @ MX → mail.{domain} on S2-primary zones ==="
rewrite_mx_on_primary ssh_s2 "${S2_PRIMARY_ZONES[@]}"
echo ""
echo "=== Fix SOA timers on S1-primary zones ==="
fix_soa_on_primary ssh_s1 "${S1_PRIMARY_ZONES[@]}"
echo ""
echo "=== Fix SOA timers on S2-primary zones ==="
fix_soa_on_primary ssh_s2 "${S2_PRIMARY_ZONES[@]}"
echo ""
echo "=== Force rndc reload on both (triggers NOTIFY via global also-notify) ==="
ssh_s1 'rndc reload' 2>&1 | head -2
ssh_s2 'rndc reload' 2>&1 | head -2
sleep 5
echo ""
echo "=== Verify MX on each sending domain (expect mail.{domain}) ==="
for zone in "${S1_PRIMARY_ZONES[@]}" "${S2_PRIMARY_ZONES[@]}"; do
  if [[ "$zone" == "launta.info" ]]; then continue; fi
  MX=$(dig +short MX ${zone} @8.8.8.8 | head -1 | tr -d '\r')
  EXPECTED="10 mail.${zone}."
  if [[ "$MX" == "$EXPECTED" ]]; then
    echo "PASS  ${zone}  → ${MX}"
  else
    echo "FAIL  ${zone}  expected '${EXPECTED}' got '${MX}'"
  fi
done
echo ""
echo "=== Verify SOA timers on each zone (expect '3600 600 2419200 3600') ==="
for zone in "${S1_PRIMARY_ZONES[@]}" "${S2_PRIMARY_ZONES[@]}"; do
  SOA_NS1=$(dig +short SOA ${zone} @69.164.213.37 2>&1 | awk '{print $4, $5, $6, $7}')
  SOA_NS2=$(dig +short SOA ${zone} @50.116.14.26 2>&1 | awk '{print $4, $5, $6, $7}')
  if [[ "$SOA_NS1" == "3600 600 2419200 3600" && "$SOA_NS2" == "3600 600 2419200 3600" ]]; then
    echo "PASS  ${zone}  timers=${SOA_NS1}"
  else
    echo "FAIL  ${zone}  ns1=${SOA_NS1} ns2=${SOA_NS2}"
  fi
done
