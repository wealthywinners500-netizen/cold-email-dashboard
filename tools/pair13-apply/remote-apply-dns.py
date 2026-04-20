#!/usr/bin/env python3
"""
remote-apply-dns.py — server-side DNS editor for Pair 13 oracle-swap.

Runs on S1 or S2 over SSH. For each primary zone:
  1. Back up /etc/bind/zones/<zone>.db
  2. Rewrite SOA tuple: 10800 3600 1814400 3600 (refresh retry expire minimum)
  3. Bump serial (max of old+1 or YYYYMMDD01)
  4. Upsert DNS records (idempotent — add if missing, update if present):
     - A     mta-sts.<zone>     -> <server_ip>
     - TXT   _smtp._tls.<zone>  -> "v=TLSRPTv1; rua=mailto:tlsrpt@launta.info"
     - TXT   _mta-sts.<zone>    -> "v=STSv1; id=<new_id>"
     - TXT   _dmarc.<zone>      -> full DMARC with sp/adkim/aspf/fo/rua/ruf
     - CAA   <zone>             -> add issuewild ";" and iodef
  5. rndc reload <zone>, confirm authoritative answer via dig @localhost

Invocation:
  remote-apply-dns.py <server_ip> <zone1> [<zone2> ...]

Example:
  remote-apply-dns.py 69.164.213.37 launta.info caleap.info

Idempotent — safe to re-run. Exits non-zero on first failure.
"""

import argparse
import datetime
import re
import shutil
import subprocess
import sys
from pathlib import Path


ZONE_DIR = Path("/home/admin/conf/dns")  # HestiaCP layout — zone files live here, not /etc/bind/zones
NEW_REFRESH = 10800
NEW_RETRY = 3600
NEW_EXPIRE = 1814400
NEW_MINIMUM = 3600
NS_DOMAIN = "launta.info"
MTA_STS_ID = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
DMARC_TXT = (
    '"v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; pct=100; '
    'fo=1; rua=mailto:dmarc-rua@launta.info; '
    'ruf=mailto:dmarc-ruf@launta.info"'
)
TLSRPT_TXT = f'"v=TLSRPTv1; rua=mailto:tlsrpt@{NS_DOMAIN}"'
MTA_STS_TXT = f'"v=STSv1; id={MTA_STS_ID}"'


def log(tag: str, msg: str) -> None:
    print(f"  [{tag}] {msg}", flush=True)


def run(cmd: list[str]) -> str:
    """Run a command, return stdout. Raise on nonzero exit."""
    r = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} exited {r.returncode}: {r.stderr.strip()}")
    return r.stdout


def new_serial(old_serial: str) -> str:
    """YYYYMMDDNN: pick max(old+1, today_base_01)."""
    today = datetime.date.today().strftime("%Y%m%d")
    today_base = int(f"{today}01")
    try:
        bumped = int(old_serial) + 1
    except ValueError:
        bumped = today_base
    return str(max(bumped, today_base))


def rewrite_soa(content: str, zone: str) -> tuple[str, str, str]:
    """Return (new_content, old_serial, new_serial)."""
    # HestiaCP SOA block, typical form (multi-line with comments):
    #   @ IN SOA ns1.zone. hostmaster.zone. (
    #       2026041906 ;serial
    #       3600       ;refresh
    #       600        ;retry
    #       2419200    ;expire
    #       3600 )     ;minimum
    # OR single-line form. We'll match either.
    soa_re = re.compile(
        r"(SOA\s+\S+\s+\S+\s*[(\s]+)"         # group 1: "SOA ns1.x. hostmaster.x. ("
        r"(\d{10})"                             # group 2: serial
        r"(\s*(?:;[^\n]*)?\s+)"                 # group 3: whitespace/comments
        r"(\d+)"                                # group 4: refresh
        r"(\s*(?:;[^\n]*)?\s+)"                 # group 5: ws
        r"(\d+)"                                # group 6: retry
        r"(\s*(?:;[^\n]*)?\s+)"                 # group 7: ws
        r"(\d+)"                                # group 8: expire
        r"(\s*(?:;[^\n]*)?\s+)"                 # group 9: ws
        r"(\d+)",                               # group 10: minimum
        re.IGNORECASE,
    )
    m = soa_re.search(content)
    if not m:
        raise RuntimeError(f"{zone}: could not locate SOA block to rewrite")
    old_serial = m.group(2)
    ns = new_serial(old_serial)
    def repl(match: re.Match) -> str:
        return (
            match.group(1) + ns
            + match.group(3) + str(NEW_REFRESH)
            + match.group(5) + str(NEW_RETRY)
            + match.group(7) + str(NEW_EXPIRE)
            + match.group(9) + str(NEW_MINIMUM)
        )
    return soa_re.sub(repl, content, count=1), old_serial, ns


def upsert_line(content: str, name: str, rtype: str, target_value: str) -> str:
    """Ensure `<name> <ttl> IN <rtype> <value>` is present with target_value.
    Match by (name, rtype); if present with different RDATA, replace; if
    absent, append before the final newline. name may be '@' or fully qualified.
    """
    # Match any existing record for this name+rtype (ignore TTL/class).
    # For TXT records, we match on the name+rtype+ANY-rdata so we can replace
    # the full TXT line (including subset variants like DMARC).
    # Name can appear as `<name>.` (FQDN) or `<name>` or `@` if zone apex.
    name_esc = re.escape(name)
    line_re = re.compile(
        r"^" + name_esc + r"\.?\s+\d*\s*IN\s+" + re.escape(rtype) + r"\s+.*$",
        re.MULTILINE,
    )
    new_line = f"{name} 3600 IN {rtype} {target_value}"
    if line_re.search(content):
        return line_re.sub(new_line, content, count=1)
    if not content.endswith("\n"):
        content += "\n"
    return content + new_line + "\n"


def upsert_caa(content: str, zone: str) -> str:
    """CAA is additive — multiple records per name — so we check per value."""
    # Desired three records (issue letsencrypt.org is likely already present).
    needed = [
        ('0 issue "letsencrypt.org"'),
        ('0 issuewild ";"'),
        (f'0 iodef "mailto:security@{NS_DOMAIN}"'),
    ]
    for rdata in needed:
        # CAA rdata is quoted; check for presence by substring match on the
        # rdata (bind normalizes whitespace).
        needle = re.sub(r"\s+", r"\\s+", re.escape(rdata))
        rec_re = re.compile(
            r"^" + re.escape(zone) + r"\.?\s+\d*\s*IN\s+CAA\s+" + needle + r"\s*$",
            re.MULTILINE,
        )
        if not rec_re.search(content):
            if not content.endswith("\n"):
                content += "\n"
            content += f"{zone}. 3600 IN CAA {rdata}\n"
    return content


def verify_zone_file(path: Path, zone: str) -> None:
    """Run named-checkzone on the updated file — refuse to reload a broken zone."""
    r = subprocess.run(
        ["named-checkzone", zone, str(path)],
        capture_output=True, text=True, check=False,
    )
    if r.returncode != 0:
        raise RuntimeError(f"{zone}: named-checkzone failed:\n{r.stdout}\n{r.stderr}")


def process_zone(zone: str, server_ip: str, ts: str) -> dict:
    """Returns a dict summary for the zone, raises on failure."""
    zone_file = ZONE_DIR / f"{zone}.db"
    if not zone_file.exists():
        raise RuntimeError(f"{zone}: {zone_file} not found")

    # Backup
    bak = zone_file.with_suffix(f".db.bak.{ts}")
    shutil.copy2(zone_file, bak)

    content = zone_file.read_text()

    # 1. SOA
    content, old_serial, ns = rewrite_soa(content, zone)

    # 2. A record for mta-sts.<zone>
    content = upsert_line(content, "mta-sts", "A", server_ip)

    # 3. TXT _smtp._tls
    content = upsert_line(content, "_smtp._tls", "TXT", TLSRPT_TXT)

    # 4. TXT _mta-sts
    content = upsert_line(content, "_mta-sts", "TXT", MTA_STS_TXT)

    # 5. TXT _dmarc (fully replace)
    content = upsert_line(content, "_dmarc", "TXT", DMARC_TXT)

    # 6. CAA enrichment
    content = upsert_caa(content, zone)

    # Write to a temp file, validate, then swap
    tmp = zone_file.with_suffix(".db.new")
    tmp.write_text(content)
    verify_zone_file(tmp, zone)
    tmp.replace(zone_file)

    # Reload via rndc
    run(["rndc", "reload", zone])

    # Confirm via dig @localhost
    soa = run(["dig", "+short", "SOA", zone, "@localhost"]).strip()

    return {
        "zone": zone,
        "old_serial": old_serial,
        "new_serial": ns,
        "backup": str(bak),
        "soa_confirmation": soa,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("server_ip", help="A record value for mta-sts.<zone>")
    ap.add_argument("zones", nargs="+", help="One or more zone names")
    args = ap.parse_args()

    ts = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    print("================================================================")
    print(f" Remote DNS apply — server IP {args.server_ip}")
    print(f" Zones: {', '.join(args.zones)}")
    print(f" SOA target: {NEW_REFRESH} {NEW_RETRY} {NEW_EXPIRE} {NEW_MINIMUM}")
    print(f" MTA-STS id: {MTA_STS_ID}")
    print(f" Backup suffix: .bak.{ts}")
    print("================================================================")
    print()

    results = []
    for zone in args.zones:
        print(f"=== {zone} ===", flush=True)
        try:
            r = process_zone(zone, args.server_ip, ts)
            log("OK ", f"{zone}: serial {r['old_serial']} → {r['new_serial']} "
                       f"(backup: {r['backup']})")
            log("SOA", r["soa_confirmation"])
            results.append((zone, True, r["new_serial"]))
        except Exception as e:
            log("FAIL", f"{zone}: {e}")
            results.append((zone, False, str(e)))
            # Hard-fail on first error — do NOT continue to other zones
            # (per prompt §6 step 7: "abort on the first failure")
            break

    print()
    print("================================================================")
    print(" RESULTS")
    for zone, ok, detail in results:
        marker = "✓" if ok else "✗"
        print(f"  {marker} {zone}: {detail}")
    print("================================================================")

    failures = [r for r in results if not r[1]]
    return 2 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
