#!/usr/bin/env bash
# verify-pair13.sh — run verify-zone.sh across all 11 Pair 13 zones.
# Pair 13 = launta.info cluster on Linode, as of 2026-04-19.
#
# Invoke from anywhere; auto-resolves sibling verify-zone.sh.

set -u
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
VERIFY="$SCRIPT_DIR/verify-zone.sh"
[[ -x "$VERIFY" ]] || { echo "ERROR: $VERIFY missing or not executable" >&2; exit 3; }

NS=launta.info
S1=69.164.213.37
S2=50.116.14.26

# NS zone + 10 sending zones (all .info)
ZONES=(
  launta.info
  caleap.info
  carena.info
  cereno.info
  cerone.info
  corina.info
  larena.info
  seamle.info
  seapot.info
  searely.info
  voility.info
)

FAIL=0
WARN_ZONES=0
FAIL_ZONES=0

for z in "${ZONES[@]}"; do
  "$VERIFY" "$z" "$NS" "$S1" "$S2"
  rc=$?
  case $rc in
    0) ;;
    1) WARN_ZONES=$((WARN_ZONES+1)) ;;
    2) FAIL_ZONES=$((FAIL_ZONES+1)); FAIL=$((FAIL+1)) ;;
    *) FAIL_ZONES=$((FAIL_ZONES+1)); FAIL=$((FAIL+1)) ;;
  esac
  echo
done

echo "================================================================"
echo "PAIR 13 SUMMARY"
echo "  Zones checked: ${#ZONES[@]}"
echo "  Zones with WARN: $WARN_ZONES"
echo "  Zones with FAIL: $FAIL_ZONES"
echo "================================================================"

# Exit 0 only if every zone was green; 1 if any WARN, 2 if any FAIL.
if (( FAIL_ZONES > 0 )); then
  exit 2
elif (( WARN_ZONES > 0 )); then
  exit 1
fi
exit 0
