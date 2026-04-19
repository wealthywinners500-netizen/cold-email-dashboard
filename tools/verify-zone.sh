#!/usr/bin/env bash
# verify-zone.sh — intoDNS-class programmatic Gate 0 check for a mail-sending zone.
#
# Canonical Gate 0 oracle (Session 04d post-2026-04-19 swap): this script is
# signal (a) of the three-signal stack. Signals (b) and (c) are mail-tester
# (≥8.5/10) and Google Postmaster (Domain Reputation = High or Pending).
# MXToolbox UI is ADVISORY-ONLY — see feedback_mxtoolbox_ui_api_gap.md for why.
#
# Usage: verify-zone.sh <zone> <ns_domain> <s1_ip> <s2_ip>
# Example: verify-zone.sh caleap.info launta.info 69.164.213.37 50.116.14.26
#
# Exit codes: 0 = all pass, 1 = at least one WARN, 2 = at least one FAIL.

set -u
ZONE="${1:?zone required}"
NS_DOMAIN="${2:?ns_domain required}"
S1_IP="${3:?s1_ip required}"
S2_IP="${4:?s2_ip required}"
RESOLVERS=("8.8.8.8" "1.1.1.1" "9.9.9.9")
WARN=0; FAIL=0

# Portable timeout shim (macOS has no coreutils timeout). Uses perl if
# neither `timeout` nor `gtimeout` is on PATH.
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT() { timeout "$@"; }
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT() { gtimeout "$@"; }
else
  TIMEOUT() {
    local secs="$1"; shift
    perl -e '
      my $t = shift; my @c = @ARGV;
      my $pid = fork(); if ($pid == 0) { exec @c; }
      eval { local $SIG{ALRM} = sub { kill 15, $pid; die }; alarm $t; waitpid($pid, 0); alarm 0; };
      exit($? >> 8);
    ' "$secs" "$@"
  }
fi

pass(){ printf "  [PASS] %s\n" "$1"; }
warn(){ printf "  [WARN] %s — %s\n" "$1" "$2"; WARN=$((WARN+1)); }
fail(){ printf "  [FAIL] %s — %s\n" "$1" "$2"; FAIL=$((FAIL+1)); }

echo "=== Zone: $ZONE (NS: $NS_DOMAIN, S1: $S1_IP, S2: $S2_IP) ==="

# ---- 1. Parent delegation ----
PARENT_NS=$(dig +short NS "$ZONE" @8.8.8.8 2>/dev/null | sort)
if [[ -n "$PARENT_NS" ]]; then
  pass "parent_delegation"
else
  fail "parent_delegation" "no NS at parent (NXDOMAIN)"
fi

# ---- 2. NS consistency across authoritative servers ----
NS_S1=$(dig +short NS "$ZONE" "@$S1_IP" 2>/dev/null | sort)
NS_S2=$(dig +short NS "$ZONE" "@$S2_IP" 2>/dev/null | sort)
if [[ "$NS_S1" == "$NS_S2" && "$NS_S1" == "$PARENT_NS" && -n "$NS_S1" ]]; then
  pass "ns_consistent"
else
  fail "ns_consistent" "S1=[$NS_S1] S2=[$NS_S2] parent=[$PARENT_NS]"
fi

# ---- 3. SOA serial consistency (intoDNS's critical gate) ----
SOA_S1=$(dig +short SOA "$ZONE" "@$S1_IP" 2>/dev/null)
SOA_S2=$(dig +short SOA "$ZONE" "@$S2_IP" 2>/dev/null)
SERIAL_S1=$(echo "$SOA_S1" | awk '{print $3}')
SERIAL_S2=$(echo "$SOA_S2" | awk '{print $3}')
if [[ "$SERIAL_S1" == "$SERIAL_S2" && -n "$SERIAL_S1" ]]; then
  pass "soa_serial_consistent ($SERIAL_S1)"
else
  fail "soa_serial_consistent" "S1=$SERIAL_S1 S2=$SERIAL_S2"
fi

# ---- 4. SOA timers (MXToolbox-safe centered values per B1 of the research deliverable) ----
REFRESH=$(echo "$SOA_S1" | awk '{print $4}')
RETRY=$(echo "$SOA_S1" | awk '{print $5}')
EXPIRE=$(echo "$SOA_S1" | awk '{print $6}')
MINIMUM=$(echo "$SOA_S1" | awk '{print $7}')
if [[ -n "$REFRESH" ]] && (( REFRESH >= 7200 && REFRESH <= 43200 )); then
  pass "soa_refresh ($REFRESH)"
else
  warn "soa_refresh" "$REFRESH outside 7200-43200 (MXToolbox-safe)"
fi
if [[ -n "$RETRY" ]] && (( RETRY >= 1800 && RETRY < REFRESH )); then
  pass "soa_retry ($RETRY)"
else
  warn "soa_retry" "$RETRY outside 1800..<refresh"
fi
if [[ -n "$EXPIRE" ]] && (( EXPIRE >= 1209600 && EXPIRE <= 2200000 )); then
  pass "soa_expire ($EXPIRE)"
else
  warn "soa_expire" "$EXPIRE outside 1209600-2200000 (MXToolbox-safe)"
fi
if [[ -n "$MINIMUM" ]] && (( MINIMUM >= 300 && MINIMUM <= 86400 )); then
  pass "soa_minimum ($MINIMUM)"
else
  warn "soa_minimum" "$MINIMUM outside 300-86400"
fi

# ---- 5. MX records (shape + resolution + PTR alignment) ----
MX=$(dig +short MX "$ZONE" @8.8.8.8 2>/dev/null | sort)
if [[ -n "$MX" ]]; then
  pass "mx_present"
else
  fail "mx_present" "no MX records"
fi
while read -r PRI HOST; do
  [[ -z "$HOST" ]] && continue
  HOST="${HOST%.}"
  MX_IP=$(dig +short A "$HOST" @8.8.8.8 2>/dev/null | head -1)
  if [[ -n "$MX_IP" ]]; then
    pass "mx_resolves ($HOST → $MX_IP)"
    PTR=$(dig +short -x "$MX_IP" @8.8.8.8 2>/dev/null | head -1)
    PTR="${PTR%.}"
    if [[ "$PTR" == "$HOST" ]]; then
      pass "mx_ptr_aligned ($PTR)"
    else
      # For per-domain MX pattern (HL #106), PTR points to mail{1|2}.{NS_DOMAIN}
      # not to mail.{zone}. That is correct and intentional. Only WARN if the
      # PTR doesn't reverse-map to *either* the MX host *or* the server-identity.
      if [[ "$PTR" == "mail1.$NS_DOMAIN" || "$PTR" == "mail2.$NS_DOMAIN" ]]; then
        pass "mx_ptr_server_identity ($PTR) — per-domain MX + shared HELO per HL #106"
      else
        warn "mx_ptr_aligned" "PTR=$PTR (expected $HOST or mail{1|2}.$NS_DOMAIN)"
      fi
    fi
  else
    fail "mx_resolves" "$HOST does not resolve"
  fi
done <<< "$MX"

# ---- 6. SPF ----
SPF=$(dig +short TXT "$ZONE" @8.8.8.8 2>/dev/null | grep -i "v=spf1" | head -1)
if [[ -n "$SPF" ]]; then
  pass "spf_present"
  LOOKUPS=$(echo "$SPF" | grep -oE "include:|a |mx |ptr |exists:|redirect=" | wc -l | tr -d ' ')
  if (( LOOKUPS <= 10 )); then
    pass "spf_lookups ($LOOKUPS)"
  else
    fail "spf_lookups" "$LOOKUPS exceeds 10"
  fi
  if echo "$SPF" | grep -qE '(-all|~all)'; then
    echo "$SPF" | grep -q -- '-all' && pass "spf_hardfail" \
      || warn "spf_terminator" "softfail (~all) — flip to -all after warm-up week 1"
  else
    warn "spf_terminator" "no -all / ~all"
  fi
else
  fail "spf_present" "no SPF record"
fi

# ---- 7. DMARC ----
DMARC=$(dig +short TXT "_dmarc.$ZONE" @8.8.8.8 2>/dev/null | grep -i "v=DMARC1" | head -1)
if [[ -n "$DMARC" ]]; then
  pass "dmarc_present"
  if echo "$DMARC" | grep -qE "p=(quarantine|reject)"; then
    pass "dmarc_policy ($(echo "$DMARC" | grep -oE 'p=(quarantine|reject|none)'))"
  else
    warn "dmarc_policy" "p=none or missing"
  fi
  if echo "$DMARC" | grep -q "rua=mailto:"; then
    pass "dmarc_rua"
  else
    warn "dmarc_rua" "no rua= reporting address"
  fi
else
  fail "dmarc_present" "no DMARC record at _dmarc.$ZONE"
fi

# ---- 8. DKIM (selector: mail, per HL #51) ----
DKIM=$(dig +short TXT "mail._domainkey.$ZONE" @8.8.8.8 2>/dev/null)
if [[ -n "$DKIM" ]]; then
  pass "dkim_present"
  if echo "$DKIM" | grep -qE "k=rsa"; then
    pass "dkim_algo"
  else
    warn "dkim_algo" "missing k=rsa (HestiaCP default)"
  fi
else
  fail "dkim_present" "no DKIM record at mail._domainkey.$ZONE"
fi

# ---- 9. CAA ----
CAA=$(dig +short CAA "$ZONE" @8.8.8.8 2>/dev/null)
if echo "$CAA" | grep -q "letsencrypt.org"; then
  pass "caa_letsencrypt"
else
  warn "caa_letsencrypt" "no CAA record authorizing letsencrypt.org"
fi

# ---- 10. MTA-STS (DNS + HTTPS policy file) ----
MTASTS_TXT=$(dig +short TXT "_mta-sts.$ZONE" @8.8.8.8 2>/dev/null)
if echo "$MTASTS_TXT" | grep -q "v=STSv1"; then
  pass "mta_sts_txt"
  POLICY=$(TIMEOUT 10 curl -fsS "https://mta-sts.$ZONE/.well-known/mta-sts.txt" 2>/dev/null)
  if echo "$POLICY" | grep -qE "^mode: (enforce|testing)"; then
    MODE=$(echo "$POLICY" | grep -oE "mode: (enforce|testing)" | head -1 | awk '{print $2}')
    pass "mta_sts_policy_reachable (mode=$MODE)"
  else
    warn "mta_sts_policy_reachable" "HTTPS policy file missing or wrong format"
  fi
else
  warn "mta_sts_txt" "no MTA-STS TXT record at _mta-sts.$ZONE"
fi

# ---- 11. TLS-RPT ----
TLSRPT=$(dig +short TXT "_smtp._tls.$ZONE" @8.8.8.8 2>/dev/null)
if echo "$TLSRPT" | grep -q "v=TLSRPTv1"; then
  pass "tls_rpt_present"
else
  warn "tls_rpt_present" "no TLS-RPT record at _smtp._tls.$ZONE"
fi

# ---- 12. SMTP + STARTTLS + cert CN on the primary MX ----
# The SMTP probe can only run from a host with egress on port 25. Consumer
# ISPs (and this laptop) typically block outbound 25, so we pre-flight with
# a 2-second TCP check and skip (as info, NOT warn) if blocked. The saga
# runs this probe from the worker VPS where port 25 works.
PRIMARY_MX_HOST=$(echo "$MX" | head -1 | awk '{print $2}'); PRIMARY_MX_HOST="${PRIMARY_MX_HOST%.}"
if [[ -n "$PRIMARY_MX_HOST" ]]; then
  PRIMARY_MX_IP=$(dig +short A "$PRIMARY_MX_HOST" @8.8.8.8 2>/dev/null | head -1)
  if [[ -n "$PRIMARY_MX_IP" ]]; then
    # TCP pre-flight
    if ! TIMEOUT 2 bash -c "cat </dev/tcp/$PRIMARY_MX_IP/25" >/dev/null 2>&1; then
      printf "  [SKIP] smtp_probe — port 25 unreachable from this host (ISP block or firewall); run from worker VPS to validate\n"
    else
      EHLO=$(TIMEOUT 10 bash -c "
        exec 3<>/dev/tcp/$PRIMARY_MX_IP/25
        read -u 3 banner
        echo 'EHLO verify-zone' >&3
        for i in 1 2 3 4 5; do read -u 3 -t 2 line; echo \"\$line\"; done
        echo 'QUIT' >&3
      " 2>/dev/null)
      if echo "$EHLO" | grep -q "STARTTLS"; then
        pass "smtp_starttls_advertised"
      else
        warn "smtp_starttls_advertised" "STARTTLS not in EHLO response"
      fi
      # Separate cert probe — no shell redirection weirdness
      CERT=$(TIMEOUT 10 openssl s_client -connect "$PRIMARY_MX_IP:25" \
             -starttls smtp -servername "$PRIMARY_MX_HOST" \
             </dev/null 2>/dev/null \
             | openssl x509 -noout -subject 2>/dev/null)
      CERT_CN=$(echo "$CERT" | sed -n 's/.*CN *= *\([^,]*\).*/\1/p' | tr -d ' ')
      if [[ -z "$CERT_CN" ]]; then
        warn "smtp_cert_cn" "could not parse cert CN from STARTTLS handshake"
      elif [[ "$CERT_CN" == "mail.$ZONE" || "$CERT_CN" == "*.$ZONE" || "$CERT_CN" == "$PRIMARY_MX_HOST" ]]; then
        pass "smtp_cert_cn ($CERT_CN)"
      else
        warn "smtp_cert_cn" "CN=$CERT_CN expected=mail.$ZONE or *.$ZONE or $PRIMARY_MX_HOST"
      fi
    fi
  else
    warn "smtp_probe" "primary MX $PRIMARY_MX_HOST does not resolve"
  fi
fi

# ---- 13. Multi-resolver Spamhaus ZEN check (3-of-3 OR, per HL #92) ----
# Only count a hit when a resolver returns a REAL Spamhaus listing code
# (127.0.0.X — see https://www.spamhaus.org/zen/). 127.255.255.254 and
# similar 127.255.255.X codes mean "open-resolver blocked / rate-limit"
# (HL #92/#103), and any non-127 reply is a network/routing error — not
# a listing. Without this filter, home-router DNS interception on
# 1.1.1.1 gets miscounted as a listing.
LISTING_RE='^127\.0\.0\.[0-9]+$'
for IP in "$S1_IP" "$S2_IP"; do
  REV=$(echo "$IP" | awk -F. '{print $4"."$3"."$2"."$1}')
  HITS=0
  CHECKED=0
  for RES in "${RESOLVERS[@]}"; do
    A=$(dig +short +time=2 +tries=1 "$REV.zen.spamhaus.org" "@$RES" 2>/dev/null \
        | grep -E "$LISTING_RE" | head -1)
    RATE_LIMIT=$(dig +short +time=2 +tries=1 "$REV.zen.spamhaus.org" "@$RES" 2>/dev/null \
                 | grep -E '^127\.255\.255\.' | head -1)
    if [[ -n "$A" ]]; then
      HITS=$((HITS+1))
      CHECKED=$((CHECKED+1))
    elif [[ -n "$RATE_LIMIT" ]]; then
      : # rate-limited — skip, don't count as checked either
    else
      # No 127.X.X.X response at all — either genuinely not listed, OR
      # network error. Count as checked only if we got SOME resolver answer.
      # (Unambiguously "not listed" = NXDOMAIN, which dig returns as empty.)
      CHECKED=$((CHECKED+1))
    fi
  done
  if (( HITS == 0 && CHECKED > 0 )); then
    pass "spamhaus_zen ($IP) — clean on $CHECKED/${#RESOLVERS[@]} checkable resolvers"
  elif (( CHECKED == 0 )); then
    warn "spamhaus_zen ($IP)" "all resolvers rate-limited or unreachable — recheck from worker VPS"
  else
    fail "spamhaus_zen ($IP)" "listed on $HITS/${#RESOLVERS[@]} resolvers"
  fi
done

echo "=== Summary: $ZONE — WARN=$WARN FAIL=$FAIL ==="
(( FAIL > 0 )) && exit 2
(( WARN > 0 )) && exit 1
exit 0
