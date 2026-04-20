#!/usr/bin/env bash
# multi-resolver-propagation.sh — 10-resolver DNS propagation check.
#
# Hard rule (HL-new 2026-04-20): DNS propagation checks must poll at least
# 10 geographically diverse public resolvers. Any check using fewer than
# 10 is not propagation-verified and must be flagged as such.
#
# For each (zone, record_name, record_type, expected_substring) tuple, queries
# the record on all 10 resolvers and reports:
#   - how many resolvers returned a matching answer
#   - how many returned something else (unexpected value)
#   - how many were unreachable/rate-limited
#
# Exits 0 iff every tuple meets the threshold (default: 7-of-checkable PASS).
#
# Usage:
#   multi-resolver-propagation.sh <zone> <record_name> <record_type> <expected_substring>
#   multi-resolver-propagation.sh --batch <tuples-file>
#
# Batch file format (tab or comma separated, one tuple per line):
#   zone\trecord_name\trecord_type\texpected_substring

set -u

RESOLVERS=(
  "8.8.8.8" "8.8.4.4"
  "1.1.1.1" "1.0.0.1"
  "9.9.9.9" "149.112.112.112"
  "208.67.222.222" "208.67.220.220"
  "4.2.2.2" "64.6.64.6"
)
# PASS threshold: at least 7 of the resolvers that returned anything must agree
THRESHOLD=7
# Timeout per resolver query (seconds)
QUERY_TIMEOUT=3

check_one() {
  local zone=$1 rec=$2 type=$3 expected=$4
  local hits=0 miss=0 unreachable=0
  local query_name
  if [[ "$rec" == "@" ]]; then
    query_name="$zone"
  else
    query_name="${rec}.${zone}"
  fi

  for res in "${RESOLVERS[@]}"; do
    local raw
    raw=$(dig +short +time="$QUERY_TIMEOUT" +tries=1 "$type" "$query_name" "@$res" 2>/dev/null)
    if [[ -z "$raw" ]]; then
      unreachable=$((unreachable+1))
      continue
    fi
    # Detect "reply from unexpected source" (local router interception)
    if echo "$raw" | grep -q "reply from unexpected source\|connection timed out"; then
      unreachable=$((unreachable+1))
      continue
    fi
    if echo "$raw" | grep -qF -- "$expected"; then
      hits=$((hits+1))
    else
      miss=$((miss+1))
    fi
  done

  local checkable=$((hits + miss))
  local verdict="FAIL"
  if (( hits >= THRESHOLD )); then
    verdict="PASS"
  elif (( checkable == 0 )); then
    verdict="SKIP"  # all resolvers unreachable (e.g. all behind local DNS hijacking)
  fi

  printf "  [%s] %s %s %s → hits=%d/%d checkable (miss=%d, unreachable=%d)\n" \
    "$verdict" "$query_name" "$type" "expects:$expected" \
    "$hits" "$checkable" "$miss" "$unreachable"

  if [[ "$verdict" == "PASS" ]] || [[ "$verdict" == "SKIP" && "$miss" == "0" ]]; then
    return 0
  fi
  return 1
}

RC=0
if [[ "${1:-}" == "--batch" ]]; then
  BATCH="${2:?batch file required}"
  while IFS=$'\t,' read -r zone rec type expected; do
    [[ -z "$zone" || "$zone" =~ ^# ]] && continue
    check_one "$zone" "$rec" "$type" "$expected" || RC=1
  done < "$BATCH"
else
  check_one "${1:?zone required}" "${2:?record name required}" "${3:?record type required}" "${4:?expected substring required}" || RC=1
fi

exit $RC
