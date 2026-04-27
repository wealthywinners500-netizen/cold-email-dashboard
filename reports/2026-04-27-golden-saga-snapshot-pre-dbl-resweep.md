# Golden saga sha256 snapshot — pre dbl-resweep PR

**Branch:** `feat/dbl-resweep-2026-04-27`
**Captured at:** 2026-04-27
**Purpose:** Forensic baseline. Future PRs touching saga territory must diff their snapshot against this list and prove no hash changed unintentionally. The dbl-resweep PR (#21) does not modify any of these files — see the grep gate evidence in `2026-04-27-dbl-resweep-grep-gate.md`.

If any future PR's snapshot drifts from these hashes WITHOUT a corresponding entry in `feedback_hard_lessons.md` explaining why, treat it as a saga-isolation breach and roll back before any other action.

## Hashes (sha256 — workspace-relative paths)

| sha256 | file |
|---|---|
| `e27a3131daf1909ae5e3fc528bf8bdc9218aca604f2dd36e1d4de0d9f7dbb8e8` | `src/lib/provisioning/pair-provisioning-saga.ts` |
| `b7725b64b5f74adcf1bb96373873e0bec4adf4aaacb889d2fc61f779eb87c5d9` | `src/worker/handlers/provision-step.ts` |
| `de657da981176e53ea2e1ff206cf09049a0265dc7488262b1d747750c7b09a91` | `src/worker/handlers/pair-verify.ts` |
| `77eef6429d43e9a2f1a42aae65f99bb3765a7bf6ea5f551f677d3694a5344841` | `src/lib/provisioning/serverless-steps.ts` |
| `16b1307847f8e57b69c42d9c38ea9555c42bde1c02e8aab7f372a8eb1c43b5c6` | `src/lib/provisioning/auto-fix.ts` |
| `88b07ba2e5545e8deb7460c3523d9ddd1c0b14f87308d1b9509313319abf3ff6` | `src/lib/provisioning/dns-templates.ts` |
| `2a669e72a7d9ebafd7412809f191686d32b0cba76879571dd4b0caa7dd79680e` | `src/lib/provisioning/domain-blacklist.ts` |
| `d34b69299f4b53778ad399fb4af8abfeb6de9493211edb38e6ffc0960c0fa5c8` | `src/lib/provisioning/domain-listing.ts` |
| `265fabab579f2d30fc7f3f2eaf6185cc6d42e90ff8c3f07feb1d115e792618f0` | `src/lib/provisioning/checks/intodns-health.ts` |
| `e9ad18006c97febf6ff7f5cea0d38d5fb4aa0444238b9b5a0f31cd9ac7a647c4` | `src/lib/provisioning/checks/mxtoolbox-health.ts` |
| `4226ac254990b99e37a1e69a2b2267bba1205231a63ae9019d7b67310cb1e532` | `src/lib/provisioning/dnsbl-liveness.ts` |
| `469ed459aeb793cab3ed6c4c28e7e6b115a31c3f5804cd05e8034bafa585f29c` | `src/app/api/provisioning/[jobId]/worker-callback/route.ts` |
| `e83158b880cf639c0a4da549431c740e04d182f04d7a2b37c947142e3812ff51` | `src/app/api/provisioning/[jobId]/execute-step/route.ts` |

## How to re-verify

From the worktree root:

```sh
shasum -a 256 \
  src/lib/provisioning/pair-provisioning-saga.ts \
  src/worker/handlers/provision-step.ts \
  src/worker/handlers/pair-verify.ts \
  src/lib/provisioning/serverless-steps.ts \
  src/lib/provisioning/auto-fix.ts \
  src/lib/provisioning/dns-templates.ts \
  src/lib/provisioning/domain-blacklist.ts \
  src/lib/provisioning/domain-listing.ts \
  src/lib/provisioning/checks/intodns-health.ts \
  src/lib/provisioning/checks/mxtoolbox-health.ts \
  src/lib/provisioning/dnsbl-liveness.ts \
  'src/app/api/provisioning/[jobId]/worker-callback/route.ts' \
  'src/app/api/provisioning/[jobId]/execute-step/route.ts'
```

Diff the output line-for-line against the table above. Any mismatch is a saga-touching change and must be flagged.
