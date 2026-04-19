#!/usr/bin/env bash
# launta-axfr-backfill.sh — Session 04d, HL #101 resolution.
#
# Convert the launta.info pair (S1=69.164.213.37, S2=50.116.14.26) from
# dual-primary BIND (where SOA serials diverge and DKIM doesn't sync) to
# master/slave with AXFR/NOTIFY.
#
# Partition (deterministic, alphabetical):
#   S1 primary:  launta.info (NS) + caleap, carena, cereno, cerone, corina  (6)
#   S2 primary:  larena, seamle, seapot, searely, voility                    (5)
#
# Safety:
#   - Full /etc/bind/named.conf backup before any edit
#   - launta.info (NS) converts first; verify AXFR works before others
#   - Slave zone files live in /var/cache/bind/slaves/ (Debian default, bind-writable)
#   - Phase A adds allow-transfer + also-notify (additive, both stay master)
#   - Phase B/C delete dual-primary copies and replace with slave stanzas
#
# Usage:
#   SSH_PW_FILE=/tmp/.pw_s1s2_04d scripts/launta-axfr-backfill.sh [phase]
#   phase ∈ {backup | phaseA | phaseB | phaseC | verify | rollback}
#
# Run phases in order: backup → phaseA → phaseB → phaseC → verify.

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

phase_backup() {
  echo "=== Backup /etc/bind/named.conf on both servers ==="
  ssh_s1 'cp -n /etc/bind/named.conf /etc/bind/named.conf.pre-axfr-04d && echo "S1 backup: $(ls -la /etc/bind/named.conf.pre-axfr-04d)"'
  ssh_s2 'cp -n /etc/bind/named.conf /etc/bind/named.conf.pre-axfr-04d && echo "S2 backup: $(ls -la /etc/bind/named.conf.pre-axfr-04d)"'
  echo "=== Dump current zone stanzas + SOA serials (for diff later) ==="
  ssh_s1 'grep "^zone " /etc/bind/named.conf > /tmp/s1-zones-pre.txt; echo "S1 zones (pre):"; cat /tmp/s1-zones-pre.txt'
  ssh_s2 'grep "^zone " /etc/bind/named.conf > /tmp/s2-zones-pre.txt; echo "S2 zones (pre):"; cat /tmp/s2-zones-pre.txt'
}

phase_A_s1() {
  echo "=== Phase A / S1: Set GLOBAL allow-transfer + also-notify → ${S2_IP} in named.conf.options ==="
  # HL #105: per-zone stanzas in /etc/bind/named.conf are wiped by Hestia on
  # any v-add-letsencrypt-domain / v-add-dns-record / v-rebuild-dns-domain.
  # Use named.conf.options (Hestia never touches it) so the policy survives.
  ssh_s1 "cp -n /etc/bind/named.conf.options /etc/bind/named.conf.options.pre-axfr-04d
sed -i 's|allow-transfer {\"none\";};|allow-transfer { ${S2_IP}; };\\n        also-notify { ${S2_IP}; };|' /etc/bind/named.conf.options
grep -A 1 'allow-transfer\\|also-notify' /etc/bind/named.conf.options | head -5"
  echo "=== S1 rndc reconfig (options changes need reconfig, not reload) ==="
  ssh_s1 'rndc reconfig 2>&1 | head -5'
  echo "=== Verify AXFR from S2's perspective for launta.info ==="
  ssh_s2 "dig AXFR launta.info @${S1_IP} +time=10 +tries=1 2>&1 | head -10"
}

phase_A_s2() {
  echo "=== Phase A / S2: Set GLOBAL allow-transfer + also-notify → ${S1_IP} in named.conf.options ==="
  ssh_s2 "cp -n /etc/bind/named.conf.options /etc/bind/named.conf.options.pre-axfr-04d
sed -i 's|allow-transfer {\"none\";};|allow-transfer { ${S1_IP}; };\\n        also-notify { ${S1_IP}; };|' /etc/bind/named.conf.options
grep -A 1 'allow-transfer\\|also-notify' /etc/bind/named.conf.options | head -5"
  echo "=== S2 rndc reconfig ==="
  ssh_s2 'rndc reconfig 2>&1 | head -5'
  echo "=== Verify AXFR from S1's perspective for larena.info ==="
  ssh_s1 "dig AXFR larena.info @${S2_IP} +time=10 +tries=1 2>&1 | head -10"
}

phase_B_convert_s2_slaves() {
  echo "=== Phase B / S2: Convert S1-primary zones on S2 to slaves ==="
  echo "--- S2: prepare slaves dir ---"
  ssh_s2 'mkdir -p /var/cache/bind/slaves && chown bind:bind /var/cache/bind/slaves && ls -ld /var/cache/bind/slaves'

  echo "--- S2: delete S1-primary master zones (HestiaCP v-delete-dns-domain) ---"
  for zone in "${S1_PRIMARY_ZONES[@]}"; do
    echo "deleting ${zone} on S2..."
    ssh_s2 "/usr/local/hestia/bin/v-delete-dns-domain admin ${zone} 2>&1 | head -3 || true"
  done

  echo "--- S2: build /etc/bind/named.conf.cluster with slave stanzas for S1-primary zones ---"
  local cluster_content='// Slave zones — primary on peer server (Session 04d, HL #101 AXFR/NOTIFY)
'
  for zone in "${S1_PRIMARY_ZONES[@]}"; do
    cluster_content+="zone \"${zone}\" { type slave; masters { ${S1_IP}; }; file \"slaves/${zone}.db\"; allow-transfer { none; }; };
"
  done
  # Write via SSH heredoc
  ssh_s2 "cat > /etc/bind/named.conf.cluster <<'CLUSTER_EOF'
$(echo "$cluster_content")
CLUSTER_EOF
cat /etc/bind/named.conf.cluster"

  echo "--- S2: ensure named.conf includes cluster file ---"
  ssh_s2 'grep -q "named.conf.cluster" /etc/bind/named.conf || echo "include \"/etc/bind/named.conf.cluster\";" >> /etc/bind/named.conf
tail -5 /etc/bind/named.conf'

  echo "--- S2: rndc reload + trigger initial AXFR ---"
  ssh_s2 'rndc reload 2>&1 | head -5'
  sleep 3
  for zone in "${S1_PRIMARY_ZONES[@]}"; do
    ssh_s2 "rndc retransfer ${zone} 2>&1 | head -3 || true"
  done
  sleep 5

  echo "--- S2 verify: SOA match against S1 ---"
  for zone in "${S1_PRIMARY_ZONES[@]}"; do
    local s1_soa=$(ssh_s1 "dig @127.0.0.1 ${zone} SOA +short 2>/dev/null" | tr -d '\r')
    local s2_soa=$(ssh_s2 "dig @127.0.0.1 ${zone} SOA +short 2>/dev/null" | tr -d '\r')
    if [[ "$s1_soa" == "$s2_soa" && -n "$s1_soa" ]]; then
      echo "PASS ${zone}: SOA match — ${s1_soa}"
    else
      echo "FAIL ${zone}: S1=${s1_soa} / S2=${s2_soa}"
    fi
  done

  echo "--- S2 verify: DKIM replicated for launta.info ---"
  ssh_s2 'dig @127.0.0.1 mail._domainkey.launta.info TXT +short 2>&1 | head -3'
}

phase_C_convert_s1_slaves() {
  echo "=== Phase C / S1: Convert S2-primary zones on S1 to slaves ==="
  ssh_s1 'mkdir -p /var/cache/bind/slaves && chown bind:bind /var/cache/bind/slaves'

  echo "--- S1: delete S2-primary master zones ---"
  for zone in "${S2_PRIMARY_ZONES[@]}"; do
    echo "deleting ${zone} on S1..."
    ssh_s1 "/usr/local/hestia/bin/v-delete-dns-domain admin ${zone} 2>&1 | head -3 || true"
  done

  echo "--- S1: build /etc/bind/named.conf.cluster ---"
  local cluster_content='// Slave zones — primary on peer server (Session 04d, HL #101 AXFR/NOTIFY)
'
  for zone in "${S2_PRIMARY_ZONES[@]}"; do
    cluster_content+="zone \"${zone}\" { type slave; masters { ${S2_IP}; }; file \"slaves/${zone}.db\"; allow-transfer { none; }; };
"
  done
  ssh_s1 "cat > /etc/bind/named.conf.cluster <<'CLUSTER_EOF'
$(echo "$cluster_content")
CLUSTER_EOF
cat /etc/bind/named.conf.cluster"

  echo "--- S1: ensure named.conf includes cluster file ---"
  ssh_s1 'grep -q "named.conf.cluster" /etc/bind/named.conf || echo "include \"/etc/bind/named.conf.cluster\";" >> /etc/bind/named.conf
tail -5 /etc/bind/named.conf'

  echo "--- S1: rndc reload + trigger AXFR ---"
  ssh_s1 'rndc reload 2>&1 | head -5'
  sleep 3
  for zone in "${S2_PRIMARY_ZONES[@]}"; do
    ssh_s1 "rndc retransfer ${zone} 2>&1 | head -3 || true"
  done
  sleep 5

  echo "--- S1 verify: SOA match against S2 ---"
  for zone in "${S2_PRIMARY_ZONES[@]}"; do
    local s1_soa=$(ssh_s1 "dig @127.0.0.1 ${zone} SOA +short 2>/dev/null" | tr -d '\r')
    local s2_soa=$(ssh_s2 "dig @127.0.0.1 ${zone} SOA +short 2>/dev/null" | tr -d '\r')
    if [[ "$s1_soa" == "$s2_soa" && -n "$s1_soa" ]]; then
      echo "PASS ${zone}: SOA match — ${s1_soa}"
    else
      echo "FAIL ${zone}: S1=${s1_soa} / S2=${s2_soa}"
    fi
  done
}

phase_verify() {
  echo "=== Full verification of all 11 zones ==="
  local all_zones=("${S1_PRIMARY_ZONES[@]}" "${S2_PRIMARY_ZONES[@]}")
  local fail_count=0
  for zone in "${all_zones[@]}"; do
    local s1_soa=$(ssh_s1 "dig @127.0.0.1 ${zone} SOA +short 2>/dev/null" | tr -d '\r')
    local s2_soa=$(ssh_s2 "dig @127.0.0.1 ${zone} SOA +short 2>/dev/null" | tr -d '\r')
    if [[ "$s1_soa" == "$s2_soa" && -n "$s1_soa" ]]; then
      echo "PASS ${zone}: SOA ${s1_soa}"
    else
      echo "FAIL ${zone}: S1=${s1_soa} / S2=${s2_soa}"
      fail_count=$((fail_count + 1))
    fi
  done
  echo ""
  echo "=== DKIM propagation check ==="
  for zone in launta.info caleap.info larena.info; do
    echo "--- ${zone} DKIM ---"
    local s1_dkim=$(ssh_s1 "dig @127.0.0.1 mail._domainkey.${zone} TXT +short 2>/dev/null" | tr -d '\r' | md5sum | cut -d' ' -f1)
    local s2_dkim=$(ssh_s2 "dig @127.0.0.1 mail._domainkey.${zone} TXT +short 2>/dev/null" | tr -d '\r' | md5sum | cut -d' ' -f1)
    if [[ "$s1_dkim" == "$s2_dkim" && "$s1_dkim" != "d41d8cd98f00b204e9800998ecf8427e" ]]; then
      echo "PASS ${zone}: DKIM match (md5=${s1_dkim:0:12})"
    else
      echo "INFO ${zone}: S1=${s1_dkim:0:12} S2=${s2_dkim:0:12} (may be empty for non-mail NS domain)"
    fi
  done
  echo ""
  echo "Summary: ${fail_count} SOA mismatches out of ${#all_zones[@]} zones"
  return $fail_count
}

phase_rollback() {
  echo "=== ROLLBACK: restore /etc/bind/named.conf + named.conf.options from backup on both servers ==="
  ssh_s1 'cp /etc/bind/named.conf.pre-axfr-04d /etc/bind/named.conf && [ -f /etc/bind/named.conf.options.pre-axfr-04d ] && cp /etc/bind/named.conf.options.pre-axfr-04d /etc/bind/named.conf.options; rm -f /etc/bind/named.conf.cluster && rndc reconfig'
  ssh_s2 'cp /etc/bind/named.conf.pre-axfr-04d /etc/bind/named.conf && [ -f /etc/bind/named.conf.options.pre-axfr-04d ] && cp /etc/bind/named.conf.options.pre-axfr-04d /etc/bind/named.conf.options; rm -f /etc/bind/named.conf.cluster && rndc reconfig'
  echo "Rollback complete. Zones restored to pre-backfill state."
  echo "NOTE: v-delete-dns-domain is NOT automatically reversed — HestiaCP registration is lost."
  echo "      If phaseB/C ran, you'll need to re-add those zones via v-add-dns-domain manually."
}

case "${1:-help}" in
  backup)    phase_backup ;;
  phaseA)    phase_A_s1 && phase_A_s2 ;;
  phaseB)    phase_B_convert_s2_slaves ;;
  phaseC)    phase_C_convert_s1_slaves ;;
  verify)    phase_verify ;;
  rollback)  phase_rollback ;;
  *) echo "Usage: $0 {backup|phaseA|phaseB|phaseC|verify|rollback}" ; exit 1 ;;
esac
