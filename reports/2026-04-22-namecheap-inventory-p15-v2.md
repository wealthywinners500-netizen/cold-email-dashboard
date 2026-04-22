# Namecheap Inventory — P15-v2 Domain Selection

**Date (UTC):** 2026-04-22
**Registrar:** Namecheap (account: `deanhofer`)
**Scope:** 22 domains newly registered 2026-04-22 (Namecheap `Created="04/22/2026"` filter via `namecheap.domains.getList`)
**Pipeline stages run:** Stage 3 (Blacklist) + Stage 4 (History). Stages 1 (Generate) + 2 (Availability) SKIPPED per prompt — Dean already purchased.
**Collision cross-check:** clean against all existing `server_pairs.ns_domain` (7) and `sending_domains.domain` (51) rows in Supabase.

---

## 1. Inventory Summary

| Metric | Value |
|---|---|
| Domains fetched from Namecheap | 22 |
| Expected count | 22 |
| Match? | ✅ YES |
| Currently blacklisted (Spamhaus DBL) | **0 / 22** |
| Currently blacklisted (SURBL multi) | **0 / 22** |
| Certificate transparency history (crt.sh) | **0 / 22** had prior certs |
| Collision with existing ns_domain or sending_domain | **0 / 22** |
| Zero-history clean slate (0 Wayback snapshots) | **11 / 22** |
| Prior Wayback history present | 11 / 22 (all currently off blacklists; deferred for review) |

---

## 2. Full 22-Domain Audit Table

| # | Domain | DBL | SURBL | crt.sh | Wayback Snaps | First Seen | Last Seen | Classification |
|---|---|---|---|---|---|---|---|---|
| 1 | camire.info  | CLEAN | CLEAN | 0 | 4  | 2013-10-05 | 2015-08-01 | RESERVED |
| 2 | carosi.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |
| 3 | cerami.info  | CLEAN | CLEAN | 0 | 5  | 2013-05-26 | 2017-06-04 | RESERVED |
| 4 | cerino.info  | CLEAN | CLEAN | 0 | 2  | 2016-10-03 | 2017-05-16 | RESERVED |
| 5 | cirone.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |
| 6 | corisa.info  | CLEAN | CLEAN | 0 | 11 | 2016-06-13 | 2017-10-14 | RESERVED |
| 7 | lamore.info  | CLEAN | CLEAN | 0 | 7  | 2013-03-30 | 2024-11-19 | RESERVED |
| 8 | lavine.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |
| 9 | lodema.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |
| 10 | luvena.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |
| 11 | malino.info  | CLEAN | CLEAN | 0 | 20 | 2009-03-31 | 2025-03-08 | RESERVED |
| 12 | marife.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |
| 13 | morice.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |
| 14 | norita.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |
| 15 | renita.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |
| 16 | rufina.info  | CLEAN | CLEAN | 0 | 4  | 2013-06-14 | 2018-08-06 | RESERVED |
| 17 | semira.info  | CLEAN | CLEAN | 0 | 6  | 2004-09-02 | 2014-01-10 | RESERVED |
| 18 | setaro.info  | CLEAN | CLEAN | 0 | 1  | 2013-07-13 | 2013-07-13 | RESERVED |
| 19 | solita.info  | CLEAN | CLEAN | 0 | 31 | 2007-12-26 | 2024-11-16 | RESERVED |
| 20 | sumita.info  | CLEAN | CLEAN | 0 | 1  | 2018-08-09 | 2018-08-09 | RESERVED |
| 21 | valone.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |
| 22 | verina.info  | CLEAN | CLEAN | 0 | 0  | — | — | **CLEAN** |

**CLEAN count = 11. Exactly enough for one full pair (1 NS + 10 sending). Selection is deterministic.**

---

## 3. Selected for P15-v2 (11 domains)

**NS domain:** `lavine.info`

Scoring (Pronounceability 25 / Trustworthiness 30 / Memorability 25 / Originality 20):

| Domain | Pron | Trust | Mem | Orig | Total |
|---|---|---|---|---|---|
| **lavine.info** | 24 | 26 | 23 | 18 | **91** |
| morice.info | 24 | 25 | 23 | 18 | 90 |
| valone.info | 24 | 25 | 23 | 18 | 90 |
| verina.info | 24 | 25 | 23 | 18 | 90 |
| renita.info | 24 | 26 | 24 | 16 | 90 |
| norita.info | 24 | 25 | 23 | 17 | 89 |
| carosi.info | 23 | 25 | 22 | 17 | 87 |
| luvena.info | 23 | 24 | 22 | 17 | 86 |
| cirone.info | 22 | 24 | 20 | 17 | 83 |
| lodema.info | 22 | 21 | 22 | 18 | 83 |
| marife.info | 21 | 20 | 20 | 17 | 78 |

**Tie-break rationale (lavine.info chosen over the 90-point cluster):** Phonetically closest to a recognizable Western surname (La Vine / Lavine), which pattern-matches Dean's prior NS domains (`launta.info`, `savini.info`, `launter.info`, `caleong.info`). TLD is `.info` (default). Zero Wayback, zero crt.sh, clean DBL + SURBL.

**10 sending domains (alphabetical):**

| # | Domain | TLD | Score | Notes |
|---|---|---|---|---|
| 1 | carosi.info | .info | 87 | clean slate |
| 2 | cirone.info | .info | 83 | clean slate |
| 3 | lodema.info | .info | 83 | clean slate |
| 4 | luvena.info | .info | 86 | clean slate |
| 5 | marife.info | .info | 78 | clean slate |
| 6 | morice.info | .info | 90 | clean slate |
| 7 | norita.info | .info | 89 | clean slate |
| 8 | renita.info | .info | 90 | clean slate |
| 9 | valone.info | .info | 90 | clean slate |
| 10 | verina.info | .info | 90 | clean slate |

All 10 share `.info` TLD — matches P11-P14 pattern. No mixed-TLD needed since all 11 clean-slate candidates happened to be `.info`.

**No collisions:**
- vs existing `server_pairs.ns_domain` (7): grocerysynergy.info, krogernetworks.info, krogertogether.info, caleong.info, launter.info, launta.info, savini.info — **none match.**
- vs existing `sending_domains.domain` (51): kroger*/caleap/caliri/carano/carena/cereno/cerone/corina/larena/lauseart/lausha/learbity/lenita/mareno/nearel/neleach/nelina/nelita/netleack/nolita/seamle/seapot/searely/segier/segierm/simoni/slaunter/slause/suleap/sulear/suleon/suleong/teresi/tregie/twilaus/veloso/verene/virina/voilift/voilit/voility — **none match.**
- "cvs" substring check (CLAUDE.md rule): all 11 names scanned — **none contain "cvs".**

---

## 4. Reserved for P16 or Later (11 domains)

These domains passed Spamhaus DBL, SURBL, and crt.sh checks but have prior Wayback archival. They are NOT quarantined (no active blacklist hit), but Dean should do a content-review pass before deploying them as sending infrastructure. Higher-risk rows are flagged.

| Domain | Snaps | Era | Risk Flag |
|---|---|---|---|
| camire.info | 4 | 2013-2015 | low (old, short span) |
| cerami.info | 5 | 2013-2017 | low |
| cerino.info | 2 | 2016-2017 | low |
| corisa.info | 11 | 2016-2017 | medium (heavier usage) |
| lamore.info | 7 | 2013-2024 | **medium-high** (recent 2024 activity — re-check content) |
| malino.info | 20 | 2009-2025 | **high** (extensive history, most recent 2025) |
| rufina.info | 4 | 2013-2018 | low |
| semira.info | 6 | 2004-2014 | low (20+ years ago, likely expired naturally) |
| setaro.info | 1 | 2013 only | low |
| solita.info | 31 | 2007-2024 | **high** (longest history, most recent 2024) |
| sumita.info | 1 | 2018 only | low |

**Recommendation:** defer all 11 to a future session that does a manual content review (fetch 2-3 Wayback snapshots per domain, visually verify no adult/gambling/malware/crypto-scam content, then promote to CLEAN). Prioritize low-risk rows first (camire, cerami, cerino, rufina, semira, setaro, sumita) for P16. malino.info, solita.info, and lamore.info warrant extra scrutiny.

---

## 5. Quarantined (0 domains)

No domains met quarantine criteria (no active DBL/SURBL listings, no active blacklist hits).

---

## 6. Namecheap NS Configuration Required

**None — the saga handles it end-to-end.**

Verified in `src/lib/provisioning/registrars/namecheap.ts`:

- **NS domain (`lavine.info`):** saga Step 3 (`configure_registrar`) calls `setNameservers` (stashing pattern) → `setGlueRecords` which creates `ns1.lavine.info` + `ns2.lavine.info` glue hosts at the registry via `domains.ns.create` and then sets `domains.dns.setCustom` with the comma-separated glue hostnames per HL #87.
- **10 sending domains:** saga Step 3 iterates each and calls `updateNameserversOnly` which points them at `ns1.lavine.info` + `ns2.lavine.info` via `domains.dns.setCustom`. It polls `domains.getInfo` for up to 5 min until the registry confirms the delegation.

Dean does **not** need to:
- log into Namecheap,
- manually create glue records,
- manually set NS delegation on sending domains,
- run any CLI from his Mac.

Dean **does** need to:
- provision 2 fresh Linodes in the dashboard UI,
- feed their IPs + the 11 selected domains into the P15-v2 form,
- click **Provision**.

---

## 7. DNS Propagation Wait Time

Expected from the saga itself (Step 4 `await_dns_propagation`):
- Namecheap glue record visibility: typically 5–15 min (polled every 30s).
- Sending-domain NS delegation confirmation at registry: up to 5 min per domain (`updateNameserversOnly` loop).
- DNS cache warming before Step 5 begins zone file creation: the saga handles retries internally.

Total Step 3 + Step 4 expected duration: **~20–30 min** under normal Namecheap API latency. If any domain's NS delegation does not confirm within 5 min, `updateNameserversOnly` fails the step and the saga aborts (see HL #87).

---

## 8. Final P15-v2 Configuration to Paste into the Dashboard Form

```
NS domain:         lavine.info
Sending domains:   carosi.info
                   cirone.info
                   lodema.info
                   luvena.info
                   marife.info
                   morice.info
                   norita.info
                   renita.info
                   valone.info
                   verina.info
Provider:          linode
Region:            us-central (S1) / us-southeast (S2)  — match prior P13/P14 pattern
Size:              small
Admin email:       dean.hofer@thestealthmail.com        — per CLAUDE.md universal admin
```

---

## 9. Evidence / Commands Run

- Namecheap API: `namecheap.domains.getList` via `https://api.namecheap.com/xml.response` with `ClientIp=200.234.226.226`, `PageSize=100`, `SortBy=CREATEDATE_DESC`. Filter: `Created="04/22/2026"`. Count = 22 ✅.
- Spamhaus DBL: `dig +short ${domain}.dbl.spamhaus.org A` — 0 positives across 22.
- SURBL multi: `dig +short ${domain}.multi.surbl.org A` — 0 positives across 22.
- crt.sh: `curl https://crt.sh/?q=${domain}&output=json` — 0 certs across 22.
- Wayback CDX: `curl https://web.archive.org/cdx/search/cdx?url=${domain}` — tabled above.
- Supabase collision check: queried `server_pairs` and `sending_domains` tables via REST; 0 overlaps.

---

## Verdict: READY FOR PROVISIONING

- 11 clean-slate sending-eligible domains selected (1 NS + 10 sending).
- All pass Terraboost's deliverability-first gate.
- Namecheap NS/glue configuration is fully automated by saga Step 3 — zero manual registrar touch required.
- P15-v2 is a code-change-free test of PR #18 (7b64ad3) on a pristine domain slate.
