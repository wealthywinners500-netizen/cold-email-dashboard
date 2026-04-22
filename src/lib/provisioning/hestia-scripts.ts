/**
 * HestiaCP Automation Scripts
 *
 * All functions take an SSHManager instance + parameters.
 * Each function is IDEMPOTENT — it checks state before executing so retries are safe.
 *
 * Hard Lessons encoded in this file:
 * #1:  Never share a hostname between two servers — each gets its own (mail1.X, mail2.X)
 * #2:  DKIM doesn't sync via HestiaCP DNS cluster — must manually copy between servers
 * #3:  SpamAssassin 3-layer kill: per-domain disable, config override, systemctl mask
 * #5:  Use mail.X format for hostnames, never panel.*
 * #12: Delete stale ns2.clouding.host NS records from new zones
 * #13: Fix 3 bad defaults on new zones (SOA MNAME, stale NS, webmail CNAME)
 * #14: fail2ban: stop + disable + mask (all three, in order)
 * #15: clamav-freshclam ALSO needs masking (not just clamav-daemon)
 * #16a: HestiaCP DNS cluster is NON-FUNCTIONAL — manual zone replication required
 * #16b: Use rndc reload for SOA serial sync — NEVER v-rebuild-dns-domains for serial sync alone
 */

import type { SSHManager, SSHCommandError } from './ssh-manager';
import { parseDNSRecords, parseDKIMOutput } from './hestia-parsers';
import type { DNSRecord } from './hestia-parsers';
import { CANONICAL_DMARC_VALUE } from './dns-templates';

/**
 * HestiaCP installs its CLI tools to /usr/local/hestia/bin/ which
 * is NOT in $PATH for non-login SSH sessions. All v-* commands must
 * be prefixed with this PATH export.
 */
export const HESTIA_PATH_PREFIX = 'export PATH=/usr/local/hestia/bin:$PATH && ';

/**
 * Full PATH for v-commands that internally invoke coreutils (hostname, date, grep, sed).
 * Used for Let's Encrypt certificate functions which need access to hostname and date.
 *
 * HL #117: v-add-letsencrypt-host requires full PATH because it internally calls
 * hostname, date, grep, sed — not just v-commands. Non-login SSH has empty $PATH.
 */
export const HESTIA_FULL_PATH = 'export PATH=/usr/local/hestia/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

// ============================================
// Types
// ============================================

export interface InstallHestiaCPParams {
  hostname: string;
  email: string;
  password: string;
  onProgress?: (line: string) => void;
}

export interface InstallHestiaCPResult {
  success: boolean;
  adminUrl: string;
}

export interface CreateDNSZoneParams {
  domain: string;
  server1IP: string;
  server2IP: string;
  nsDomain: string;
  isNSDomain: boolean;
  records?: DNSRecord[];
  primaryIP?: string;
}

export interface CreateMailDomainParams {
  domain: string;
  accounts: string[];
  password: string;
  adminEmail?: string | null;
}

export interface CreateMailDomainResult {
  dkimRecord: string;
  accounts: string[];
}

export interface ReplicateZoneParams {
  domain: string;
  includeMailDomains: boolean;
}

export interface IssueSSLCertParams {
  domain: string;
  isHostname: boolean;
}

export interface IssueSSLCertResult {
  success: boolean;
  cn: string;
}

// ============================================
// a) Full unattended HestiaCP install
// ============================================

/**
 * Install HestiaCP via SSH (for providers without cloud-init, e.g. Clouding.io).
 * Downloads hst-install.sh and runs with unattended flags.
 *
 * Hard Lesson #5: hostname must use mail.X format, never panel.*
 * Security: fail2ban, clamav, spamassassin all disabled at install time.
 */
export async function installHestiaCP(
  ssh: SSHManager,
  params: InstallHestiaCPParams
): Promise<InstallHestiaCPResult> {
  const { hostname, email, password, onProgress } = params;

  // Escape password for shell: wrap in single quotes, escape inner single quotes
  const escapedPassword = password.replace(/'/g, "'\\''");

  // Check if HestiaCP is already installed (idempotent)
  try {
    const checkResult = await ssh.exec(`${HESTIA_PATH_PREFIX}which v-list-sys-info`, { timeout: 10000 });
    if (checkResult.code === 0) {
      const adminUrl = `https://${hostname}:8083`;
      return { success: true, adminUrl };
    }
  } catch {
    // Not installed, proceed
  }

  // Remove packages that conflict with HestiaCP installer
  // Linode/DigitalOcean Ubuntu 22.04 images come with ufw pre-installed,
  // which causes HestiaCP installer to abort with "should be installed on a clean server"
  onProgress?.('Removing conflicting packages (ufw)...');
  try {
    await ssh.exec('DEBIAN_FRONTEND=noninteractive apt-get purge -y ufw 2>/dev/null || true', { timeout: 60000 });
    await ssh.exec('apt-get autoremove -y 2>/dev/null || true', { timeout: 60000 });
  } catch {
    // Ignore — ufw may not be installed on all providers
  }

  // Download installer
  const downloadCmd = 'wget -q https://raw.githubusercontent.com/hestiacp/hestiacp/release/install/hst-install.sh -O /tmp/hst-install.sh && chmod +x /tmp/hst-install.sh';
  await ssh.exec(downloadCmd, { timeout: 60000 });

  // Run unattended install (10-20 min typically)
  const installCmd = [
    '/tmp/hst-install.sh',
    `--hostname '${hostname}'`,
    '--username admin',
    `--email '${email}'`,
    `--password '${escapedPassword}'`,
    '--interactive no',
    '--apache yes',
    '--phpfpm yes',
    '--exim yes',
    '--dovecot yes',
    '--clamav no',
    '--spamassassin no',
    '--fail2ban no',
    '--api yes',
  ].join(' ');

  const exitCode = await ssh.execStream(
    installCmd,
    (line) => onProgress?.(line),
    (line) => onProgress?.(line)
  );

  const success = exitCode === 0;

  // --- PATCH 14: Mask Exim4 immediately after install ---
  // Exim4 starts automatically during HestiaCP install. We must prevent it
  // from listening on port 25 until ALL auth records (SPF, DKIM, DMARC, PTR)
  // are in place. Otherwise any inbound SMTP probe or bounce goes out from
  // an unauthenticated fresh IP — blacklist bait (Hard Lesson #84).
  if (success) {
    onProgress?.('Masking Exim4 until auth records are ready...');
    await ssh.exec(
      'systemctl stop exim4 && systemctl mask exim4 && systemctl stop dovecot && systemctl mask dovecot',
      { timeout: 15000 }
    ).catch((err) => {
      // Log but don't fail — worst case Exim runs early, same as before PATCH 14
      console.error(`[installHestiaCP] Warning: could not mask exim4: ${err}`);
    });
  }

  const adminUrl = `https://${hostname}:8083`;

  return { success, adminUrl };
}

// ============================================
// b) Create DNS zone with all required records
// ============================================

/**
 * Creates a DNS zone with all required records for mail server operation.
 *
 * Hard Lesson #12: Delete stale ns2.clouding.host NS records
 * Hard Lesson #13: Fix 3 bad defaults (SOA MNAME, stale NS, webmail CNAME)
 */
export async function createDNSZone(
  ssh: SSHManager,
  params: CreateDNSZoneParams
): Promise<void> {
  const { domain, server1IP, server2IP, nsDomain, isNSDomain, records, primaryIP } = params;

  // Check if zone already exists (idempotent)
  try {
    const checkResult = await ssh.exec(`${HESTIA_PATH_PREFIX}v-list-dns-domain admin ${domain} 2>/dev/null`, { timeout: 10000 });
    if (checkResult.code === 0 && checkResult.stdout.trim().length > 0) {
      // Zone exists — clean it up and ensure records are correct
      await cleanupDNSZoneDefaults(ssh, domain, nsDomain);
      await ensureDNSRecords(ssh, domain, server1IP, server2IP, nsDomain, isNSDomain, records, primaryIP);
      return;
    }
  } catch {
    // Zone doesn't exist, create it
  }

  // Create the zone — use primaryIP so S2 domains get @ A → server2IP from the start
  // Hard Lesson #104: v-add-dns-domain creates a default @ A record with the IP you pass.
  // If you always pass server1IP, S2 domains get dual @ A records (server1IP + server2IP from ensureDNSRecords)
  // which breaks LE multi-vantage validation.
  const zoneIP = primaryIP || server1IP;
  await ssh.exec(`${HESTIA_PATH_PREFIX}v-add-dns-domain admin ${domain} ${zoneIP}`, { timeout: 30000 });

  // Clean up bad defaults (Hard Lesson #12, #13)
  await cleanupDNSZoneDefaults(ssh, domain, nsDomain);

  // Add all required records
  await ensureDNSRecords(ssh, domain, server1IP, server2IP, nsDomain, isNSDomain, records, primaryIP);
}

/**
 * Remove bad default records that HestiaCP creates on new zones.
 *
 * Hard Lesson #12: Delete stale ns2.clouding.host NS records
 * Hard Lesson #13: Fix SOA MNAME, remove stale NS, remove webmail CNAME
 */
async function cleanupDNSZoneDefaults(
  ssh: SSHManager,
  domain: string,
  nsDomain: string
): Promise<void> {
  // List existing records
  const { stdout } = await ssh.exec(`${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`, { timeout: 15000 });
  const existingRecords = parseDNSRecords(stdout);

  for (const record of existingRecords) {
    // Hard Lesson #12: Remove stale ns2.clouding.host NS records
    if (record.type === 'NS' && record.value.includes('clouding.host')) {
      await ssh.exec(`${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${record.id}`, { timeout: 10000 });
    }

    // Hard Lesson #13: Remove default webmail CNAME
    if (record.type === 'CNAME' && record.host === 'webmail') {
      await ssh.exec(`${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${record.id}`, { timeout: 10000 });
    }

    // Remove any stale NS records that don't match our nsDomain
    if (record.type === 'NS' && !record.value.includes(nsDomain)) {
      await ssh.exec(`${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${record.id}`, { timeout: 10000 });
    }

    // HL #128: Remove HestiaCP auto-generated root SPF
    // v-add-dns-domain creates a default SPF with only s1's IP.
    // ensureDNSRecords will add the correct both-IP SPF for NS domains,
    // and createMailDomain will add it for sending domains in Step 6.
    if (record.type === 'TXT' && record.host === '@' && record.value.toLowerCase().includes('v=spf1')) {
      await ssh.exec(`${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${record.id}`, { timeout: 10000 });
    }

    // Hard Lesson #104: Remove default @ A record.
    // v-add-dns-domain creates @ A → the IP we pass. Even though we now pass primaryIP,
    // on idempotent re-runs or edge cases, stale @ A records can linger.
    // Remove ALL @ A records here — ensureDNSRecords will add the correct one next.
    if (record.type === 'A' && record.host === '@') {
      await ssh.exec(`${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${record.id}`, { timeout: 10000 });
    }
  }

  // Hard Lesson #13: Fix SOA MNAME to ns1.NSDOMAIN
  // HL #107 (Session 04d): Also set Refresh/Retry/Expire/Minimum timers to
  // values MXToolbox accepts. HestiaCP's factory default `7200 3600 1209600
  // 180` triggers "SOA Refresh Value out of recommended range" and "SOA
  // Minimum TTL Value out of recommended range" warnings. Use RFC 1912 §2.2
  // safe values: Refresh 3600 (1hr), Retry 600 (10min), Expire 2419200 (4wk),
  // Minimum 3600 (1hr).
  //
  // HestiaCP 1.9.4 `v-change-dns-domain-soa` signature is `USER DOMAIN SOA
  // [RESTART]` — the trailing 4 timer args are silently ignored. We pass them
  // anyway (future-compat) but the actual timer enforcement comes from
  // `patchDomainSHSOATemplate` which rewrites the hardcoded SOA block in
  // `/usr/local/hestia/func/domain.sh` before any zone is created. This call
  // here triggers `update_domain_zone()` which uses the patched template and
  // updates the zone file MNAME.
  //
  // Prior behaviour swallowed all errors with `.catch(() => {})`, masking
  // config drift (the P14 parity-to-P13 incident of 2026-04-22). We now
  // surface unexpected failures.
  try {
    await ssh.exec(
      `${HESTIA_PATH_PREFIX}v-change-dns-domain-soa admin ${domain} ns1.${nsDomain} '' 3600 600 2419200 3600`,
      { timeout: 10000 }
    );
  } catch (err: unknown) {
    const e = err as SSHCommandError | Error;
    const stderr = (e as SSHCommandError)?.stderr ?? '';
    const stdout = (e as SSHCommandError)?.stdout ?? '';
    const msg = (e as Error)?.message ?? String(err);
    // HestiaCP versions <1.x may lack this command entirely — "command not
    // found" / "not installed" / exit 127 is the only failure we tolerate.
    const notFound =
      /command not found/i.test(stderr) ||
      /command not found/i.test(msg) ||
      /127/.test(String((e as SSHCommandError)?.code ?? ''));
    if (!notFound) {
      throw new Error(
        `v-change-dns-domain-soa failed on ${domain} (non-ENOENT): code=${(e as SSHCommandError)?.code}; stderr=${stderr}; stdout=${stdout}; msg=${msg}`
      );
    }
    // else: older Hestia — caller expected to have patched domain.sh, which
    // takes effect on the next zone regen via any other DNS-modifying call.
  }
}

/**
 * HL #107 durable fix: patch `/usr/local/hestia/func/domain.sh` so the
 * `update_domain_zone()` function's hardcoded SOA block uses RFC 1912 §2.2
 * MXToolbox-safe timer values (`3600 600 2419200 3600`) instead of the
 * HestiaCP factory defaults (`7200 $refresh 1209600 180`). Every subsequent
 * zone regen — triggered by `v-add-dns-record`, `v-delete-dns-record`,
 * `v-change-dns-domain-soa`, `v-rebuild-dns-domain`, or any Hestia CLI call
 * that internally rebuilds (e.g. `v-add-letsencrypt-domain`) — writes the
 * zone file from this template, so HL #107 timers persist through the full
 * lifecycle of the pair.
 *
 * Idempotent via a bash-comment marker placed ABOVE the
 * `update_domain_zone()` function. The marker MUST NOT appear inside the
 * zone-template echo block — prior patch attempts that inlined the marker
 * there leaked `# HL-107-patched` into zone files and broke
 * `named-checkzone` with "near '#': extra input text" (observed during the
 * P14 parity pass on 2026-04-22).
 *
 * Background: P13 (launta.info) received this patch manually during the
 * 2026-04-19/20 Session 04d operational backfill and passes MXToolbox 0/0.
 * P14 (savini.info) shipped without it and hit "SOA Serial Number Format is
 * Invalid" / factory timers until the 2026-04-22 live parity pass. This
 * function promotes that manual backfill into a deterministic saga step so
 * all future pairs (P15+) inherit HL #107 timers from provisioning time.
 *
 * Failure modes:
 *   - marker present → idempotent no-op (logs "already applied").
 *   - factory SOA block not found → throws (HestiaCP version drift; halt
 *     and escalate rather than apply a best-guess patch).
 */
export async function patchDomainSHSOATemplate(ssh: SSHManager): Promise<void> {
  // The Python heredoc is single-quoted (`<<'PYEOF'`) so bash does not expand
  // `$SERIAL`, `$refresh`, or any `$var` in the match/replace strings.
  const script = [
    'set -e',
    "MARKER_SUBSTRING='HL-107-patched'",
    'DOMAIN_SH=/usr/local/hestia/func/domain.sh',
    'if [ ! -f "$DOMAIN_SH" ]; then',
    '  echo "ERROR: $DOMAIN_SH not found (HestiaCP not installed?)" >&2',
    '  exit 2',
    'fi',
    'if grep -q "$MARKER_SUBSTRING" "$DOMAIN_SH"; then',
    '  echo "HL-107 domain.sh patch already applied — skipping."',
    '  exit 0',
    'fi',
    "python3 - <<'PYEOF'",
    'import sys',
    "path = '/usr/local/hestia/func/domain.sh'",
    "with open(path, 'r') as f:",
    '    s = f.read()',
    '',
    "# Factory SOA block inside update_domain_zone() — matches Hestia 1.9.x.",
    '# Matches the exact whitespace/lines as written by the echo statement.',
    'factory = (',
    "    '                                            $SERIAL\\n'",
    "    '                                            7200\\n'",
    "    '                                            $refresh\\n'",
    "    '                                            1209600\\n'",
    "    '                                            180 )\\n'",
    ')',
    'patched = (',
    "    '                                            $SERIAL\\n'",
    "    '                                            3600\\n'",
    "    '                                            600\\n'",
    "    '                                            2419200\\n'",
    "    '                                            3600 )\\n'",
    ')',
    '',
    'if factory not in s:',
    "    print('ERROR: factory SOA block not found in domain.sh — HestiaCP version drift', file=sys.stderr)",
    '    sys.exit(1)',
    '',
    's2 = s.replace(factory, patched, 1)',
    "MARKER = '# HL-107-patched: SOA block uses 3600/600/2419200/3600 instead of factory 7200/$refresh/1209600/180'",
    "anchor = '# Update domain zone\\nupdate_domain_zone() {'",
    'if anchor in s2:',
    "    s2 = s2.replace(anchor, MARKER + '\\n' + anchor, 1)",
    'else:',
    "    print('WARN: anchor not found — marker prepended to file', file=sys.stderr)",
    "    s2 = MARKER + '\\n' + s2",
    '',
    "with open(path, 'w') as f:",
    '    f.write(s2)',
    "print('HL-107 domain.sh patch applied')",
    'PYEOF',
    'grep -q "$MARKER_SUBSTRING" "$DOMAIN_SH" && echo "marker confirmed"',
  ].join('\n');

  const result = await ssh.exec(script, { timeout: 30000 });
  if (result.code !== 0) {
    throw new Error(
      `patchDomainSHSOATemplate failed on ${ssh.constructor.name}: code=${result.code}; stderr=${result.stderr}; stdout=${result.stdout}`
    );
  }
  if (
    !/HL-107 domain.sh patch applied|already applied/.test(result.stdout)
  ) {
    throw new Error(
      `patchDomainSHSOATemplate did not confirm apply/skip: stdout=${result.stdout}; stderr=${result.stderr}`
    );
  }
}

/**
 * Ensure all required DNS records exist for the zone.
 */
async function ensureDNSRecords(
  ssh: SSHManager,
  domain: string,
  server1IP: string,
  server2IP: string,
  nsDomain: string,
  isNSDomain: boolean,
  extraRecords?: DNSRecord[],
  primaryIP?: string
): Promise<void> {
  // Build the required record set
  const requiredRecords: Array<{type: string; host: string; value: string; priority?: number}> = [
    // A records — primaryIP determines which server this domain resolves to
    // (S2 domains need @ A → server2IP so LE HTTP-01 validation reaches the right server)
    { type: 'A', host: '@', value: primaryIP || server1IP },
    { type: 'A', host: 'mail1', value: server1IP },
    { type: 'A', host: 'mail2', value: server2IP },

    // NS records pointing to our nameservers
    { type: 'NS', host: '@', value: `ns1.${nsDomain}` },
    { type: 'NS', host: '@', value: `ns2.${nsDomain}` },

    // MX record
    { type: 'MX', host: '@', value: `mail1.${domain}`, priority: 10 },

    // HELO SPF records for mail1 and mail2 subdomains
    { type: 'TXT', host: 'mail1', value: '"v=spf1 a -all"' },
    { type: 'TXT', host: 'mail2', value: '"v=spf1 a -all"' },
  ];

  // If this IS the NS domain, add ns1/ns2 A records (glue records served by HestiaCP)
  if (isNSDomain) {
    requiredRecords.push(
      { type: 'A', host: 'ns1', value: server1IP },
      { type: 'A', host: 'ns2', value: server2IP }
    );
    // HL #128: NS domain root SPF must include both server IPs.
    // HestiaCP auto-generates a root SPF with only s1's IP during
    // v-add-dns-domain. cleanupDNSZoneDefaults deletes it, and we add
    // the correct one here with both IPs for HELO SPF alignment.
    requiredRecords.push(
      { type: 'TXT', host: '@', value: `"v=spf1 ip4:${server1IP} ip4:${server2IP} a mx -all"` }
    );
    // PATCH 11: NS domain needs DMARC too. MXToolbox flags "No DMARC Record found"
    // on any domain without a _dmarc TXT record — including the NS/hostname domain.
    // HL #135: Every domain that appears in DNS must have a DMARC record.
    requiredRecords.push(
      // HL #109 canonical DMARC (see dns-templates.ts).
      { type: 'TXT', host: '_dmarc', value: CANONICAL_DMARC_VALUE }
    );
  }

  // Add any extra records from params
  if (extraRecords) {
    for (const r of extraRecords) {
      requiredRecords.push({
        type: r.type,
        host: r.host,
        value: r.value,
        priority: r.priority,
      });
    }
  }

  // Get existing records for comparison
  const { stdout } = await ssh.exec(`${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`, { timeout: 15000 });
  const existing = parseDNSRecords(stdout);

  // Add records that don't already exist
  for (const req of requiredRecords) {
    const alreadyExists = existing.some(
      (e) =>
        e.type === req.type &&
        e.host === req.host &&
        e.value === req.value
    );

    if (!alreadyExists) {
      const priorityArg = req.priority !== undefined ? req.priority : '';
      try {
        await ssh.exec(
          `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} ${req.host} ${req.type} '${req.value}' ${priorityArg}`.trim(),
          { timeout: 10000 }
        );
      } catch (err: any) {
        // HestiaCP exit code 3 = record already exists (parser may miss trailing dots etc.)
        // Exit code 4 = object doesn't exist (e.g., DNS zone not ready yet)
        // Treat code 3 as non-fatal for idempotency
        if (err?.code === 3) {
          // Record already exists — skip silently
        } else {
          throw err;
        }
      }
    }
  }
}

// ============================================
// c) Create mail domain with accounts and DKIM
// ============================================

/**
 * Creates a mail domain, generates DKIM, sets SPF/DMARC, and creates accounts.
 *
 * Accounts are pre-generated firstname.lastname pairs from the name generator.
 */
export async function createMailDomain(
  ssh: SSHManager,
  params: CreateMailDomainParams
): Promise<CreateMailDomainResult> {
  const { domain, accounts, password } = params;
  const escapedPassword = password.replace(/'/g, "'\\''");

  // Check if mail domain already exists (idempotent)
  try {
    const checkResult = await ssh.exec(`${HESTIA_PATH_PREFIX}v-list-mail-domain admin ${domain} 2>/dev/null`, { timeout: 10000 });
    if (checkResult.code === 0 && checkResult.stdout.trim().length > 0) {
      // Already exists — just ensure accounts and DKIM
      const dkimRecord = await extractDKIM(ssh, domain);
      await ensureMailAccounts(ssh, domain, accounts, escapedPassword);
      return { dkimRecord, accounts };
    }
  } catch {
    // Doesn't exist, create it
  }

  // Create mail domain. Modern HestiaCP (1.8+) creates the mail domain WITH
  // DKIM=yes enabled by default, so v-add-mail-domain-dkim would then fail with
  // exit code 4 (E_EXISTS: "DKIM=yes already exists"). We check the DKIM field
  // after creation and only call v-add-mail-domain-dkim if it's not already set.
  await ssh.exec(`${HESTIA_PATH_PREFIX}v-add-mail-domain admin ${domain}`, { timeout: 15000 });

  // Wait briefly for HestiaCP to commit the new domain to mail.conf
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Check whether DKIM is already enabled on the newly-created domain
  let dkimAlreadyEnabled = false;
  try {
    const dkimCheck = await ssh.exec(
      `${HESTIA_PATH_PREFIX}v-list-mail-domain admin ${domain} json 2>/dev/null | grep -i '"DKIM"' || true`,
      { timeout: 10000 }
    );
    dkimAlreadyEnabled = /["']?DKIM["']?\s*:\s*["']?yes/i.test(dkimCheck.stdout);
  } catch {
    // Fall through — will try to enable DKIM below
  }

  if (!dkimAlreadyEnabled) {
    // v-add-mail-domain did not auto-enable DKIM — enable it now.
    // Retry once in case the domain hasn't fully committed yet.
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await ssh.exec(
          `${HESTIA_PATH_PREFIX}v-add-mail-domain-dkim admin ${domain}`,
          { timeout: 15000 }
        );
        lastErr = null;
        break;
      } catch (err: unknown) {
        lastErr = err;
        const errMsg = err instanceof Error ? err.message : String(err);
        // If HestiaCP reports DKIM already exists, treat as success
        if (/already exists/i.test(errMsg) || /DKIM=yes/i.test(errMsg)) {
          lastErr = null;
          break;
        }
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }
    if (lastErr) throw lastErr;
  }

  // SPF and DMARC records are NOT created here. HestiaCP's v-add-mail-domain
  // auto-generates defaults, but they're incorrect (generic +a +mx, no explicit IP).
  // Step 6's dedup block (pair-provisioning-saga.ts) deletes ALL SPF/DMARC records
  // and adds the correct versions with explicit server IPs. Creating throwaway
  // records here just creates a brief window of wrong auth. (Hard Lesson #84)
  //
  // Previously this block contained dedup + canonical SPF/DMARC
  // creation. That logic is now consolidated into the saga's Step 6 dedup block,
  // which has full context (both server IPs, admin email) and runs AFTER all
  // domains are created on both servers.

  // Create mail accounts
  await ensureMailAccounts(ssh, domain, accounts, escapedPassword);

  // Extract DKIM record
  const dkimRecord = await extractDKIM(ssh, domain);

  return { dkimRecord, accounts };
}

/**
 * Ensure all required mail accounts exist for a domain.
 */
async function ensureMailAccounts(
  ssh: SSHManager,
  domain: string,
  accounts: string[],
  escapedPassword: string
): Promise<void> {
  for (const account of accounts) {
    try {
      await ssh.exec(
        `${HESTIA_PATH_PREFIX}v-add-mail-account admin ${domain} ${account} '${escapedPassword}'`,
        { timeout: 10000 }
      );
    } catch (err) {
      // Account may already exist — check error message
      const error = err as SSHCommandError;
      if (error.stderr?.includes('already exists') || error.stdout?.includes('already exists')) {
        // OK — idempotent
        continue;
      }
      throw err;
    }
  }
}

// ============================================
// d) Extract DKIM record value
// ============================================

/**
 * Extract and return the DKIM TXT record value for a domain.
 */
export async function extractDKIM(ssh: SSHManager, domain: string): Promise<string> {
  const { stdout } = await ssh.exec(
    `${HESTIA_PATH_PREFIX}v-list-mail-domain-dkim-dns admin ${domain}`,
    { timeout: 15000 }
  );
  return parseDKIMOutput(stdout);
}

// ============================================
// e) Replicate zone from Server 1 to Server 2
// ============================================

/**
 * Replicates a DNS zone from source server to target server.
 *
 * Hard Lesson #2: DKIM doesn't sync via HestiaCP DNS cluster — must manually copy
 * Hard Lesson #16a: HestiaCP DNS cluster is NON-FUNCTIONAL — manual replication required
 * Hard Lesson #16b: Use rndc reload — NEVER v-rebuild-dns-domains for serial sync alone
 */
export async function replicateZone(
  sourceSSH: SSHManager,
  targetSSH: SSHManager,
  params: ReplicateZoneParams
): Promise<void> {
  const { domain, includeMailDomains } = params;

  // Read all records from source
  const { stdout: sourceRecordsRaw } = await sourceSSH.exec(
    `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
    { timeout: 15000 }
  );
  const sourceRecords = parseDNSRecords(sourceRecordsRaw);

  // Check if zone already exists on target (idempotent)
  let targetZoneExists = false;
  try {
    const checkResult = await targetSSH.exec(`${HESTIA_PATH_PREFIX}v-list-dns-domain admin ${domain} 2>/dev/null`, { timeout: 10000 });
    if (checkResult.code === 0 && checkResult.stdout.trim().length > 0) {
      targetZoneExists = true;
    }
  } catch {
    // Doesn't exist
  }

  if (!targetZoneExists) {
    // Get the primary A record value for zone creation
    const primaryRecord = sourceRecords.find((r) => r.type === 'A' && r.host === '@');
    const primaryIP = primaryRecord?.value || '127.0.0.1';

    // Create the zone on target
    await targetSSH.exec(`${HESTIA_PATH_PREFIX}v-add-dns-domain admin ${domain} ${primaryIP}`, { timeout: 30000 });
  }

  // Delete stale defaults on target (same cleanup as createDNSZone)
  // Hard Lesson #12, #13
  const { stdout: targetRecordsRaw } = await targetSSH.exec(
    `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
    { timeout: 15000 }
  );
  const targetRecords = parseDNSRecords(targetRecordsRaw);

  for (const record of targetRecords) {
    if (record.type === 'NS' && record.value.includes('clouding.host')) {
      await targetSSH.exec(`${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${record.id}`, { timeout: 10000 });
    }
    if (record.type === 'CNAME' && record.host === 'webmail') {
      await targetSSH.exec(`${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${record.id}`, { timeout: 10000 });
    }
  }

  // Refresh target records after cleanup
  const { stdout: cleanTargetRaw } = await targetSSH.exec(
    `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
    { timeout: 15000 }
  );
  const cleanTargetRecords = parseDNSRecords(cleanTargetRaw);

  // Add each source record to target if not already present
  for (const srcRecord of sourceRecords) {
    // Skip SOA records (auto-managed)
    if (srcRecord.type === 'SOA') continue;

    const existsOnTarget = cleanTargetRecords.some(
      (t) =>
        t.type === srcRecord.type &&
        t.host === srcRecord.host &&
        t.value === srcRecord.value
    );

    if (!existsOnTarget) {
      const priorityArg = srcRecord.priority !== undefined ? srcRecord.priority : '';
      try {
        await targetSSH.exec(
          `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} ${srcRecord.host} ${srcRecord.type} '${srcRecord.value}' ${priorityArg}`.trim(),
          { timeout: 10000 }
        );
      } catch (err: any) {
        // HestiaCP exit code 3 = record already exists — non-fatal
        if (err?.code === 3) {
          // Skip silently
        } else {
          throw err;
        }
      }
    }
  }

  // Hard Lesson #2: Explicitly copy DKIM records if mail domains are included
  if (includeMailDomains) {
    try {
      const sourceDKIM = await extractDKIM(sourceSSH, domain);
      if (sourceDKIM) {
        // Ensure mail domain exists on target
        try {
          await targetSSH.exec(`${HESTIA_PATH_PREFIX}v-add-mail-domain admin ${domain}`, { timeout: 15000 });
        } catch {
          // May already exist
        }

        // Add DKIM to target DNS
        const dkimHost = `_domainkey.${domain}`;
        await targetSSH.exec(
          `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} ${dkimHost} TXT '${sourceDKIM}'`,
          { timeout: 10000 }
        ).catch(() => {
          // May already exist
        });
      }
    } catch {
      // DKIM extraction failed — non-fatal for zone replication
    }
  }

  // Hard Lesson #16b: Use rndc reload on BOTH servers — NEVER v-rebuild-dns-domains for serial sync
  await sourceSSH.exec('rndc reload', { timeout: 10000 }).catch(() => {});
  await targetSSH.exec('rndc reload', { timeout: 10000 }).catch(() => {});
}

/**
 * HL #112: Sync zone DB files from S1 → S2 via SSH.
 * HestiaCP DNS cluster is non-functional (#16a), so after any DNS record
 * modification on S1 we must copy the zone files to S2 and reload BIND.
 * This ensures SOA serials match and all records are identical on both
 * authoritative nameservers (fixes MXToolbox "Serial numbers do not match").
 *
 * Requires sshpass on S1 (installed automatically if missing).
 */
export async function syncZoneFiles(
  sourceSSH: SSHManager,
  targetIP: string,
  targetPassword: string,
  domains: string[],
): Promise<{ synced: string[]; failed: string[] }> {
  const synced: string[] = [];
  const failed: string[] = [];

  // Ensure sshpass is available on source
  await sourceSSH.exec(
    'which sshpass >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y sshpass >/dev/null 2>&1',
    { timeout: 30000 }
  ).catch(() => {});

  for (const domain of domains) {
    const zonePath = `/home/admin/conf/dns/${domain}.db`;
    try {
      await sourceSSH.exec(
        `sshpass -p '${targetPassword.replace(/'/g, "'\\''")}' scp -o StrictHostKeyChecking=no ${zonePath} root@${targetIP}:${zonePath}`,
        { timeout: 15000 }
      );
      synced.push(domain);
    } catch {
      failed.push(domain);
    }
  }

  // Reload BIND on target to pick up new zone files
  await sourceSSH.exec(
    `sshpass -p '${targetPassword.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no root@${targetIP} 'rndc reload'`,
    { timeout: 15000 }
  ).catch(() => {});

  // Verify reload succeeded on target — query each synced domain
  for (const domain of synced) {
    try {
      const verifyResult = await sourceSSH.exec(
        `sshpass -p '${targetPassword.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no root@${targetIP} 'dig SOA ${domain} @127.0.0.1 +short 2>/dev/null'`,
        { timeout: 10000 }
      );
      if (!verifyResult.stdout.trim()) {
        // Zone not responding after reload — force rebuild
        await sourceSSH.exec(
          `sshpass -p '${targetPassword.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no root@${targetIP} '${HESTIA_PATH_PREFIX}v-rebuild-dns-domain admin ${domain} 2>/dev/null; rndc reload 2>/dev/null'`,
          { timeout: 15000 }
        ).catch(() => {});
      }
    } catch {
      // Non-fatal — the zone might still be loading
    }
  }

  // Also reload source
  await sourceSSH.exec('rndc reload', { timeout: 10000 }).catch(() => {});

  return { synced, failed };
}

// ============================================
// f) Security hardening
// ============================================

/**
 * Full security hardening for a HestiaCP server.
 *
 * Hard Lesson #3:  SpamAssassin 3-layer kill
 * Hard Lesson #14: fail2ban: stop + disable + mask (all three, in order)
 * Hard Lesson #15: clamav-freshclam ALSO needs masking (not just clamav-daemon)
 */
export async function hardenSecurity(ssh: SSHManager): Promise<void> {
  // Check if already hardened (idempotent) — if spamassassin is masked, we're good
  try {
    const { stdout } = await ssh.exec('systemctl is-enabled spamassassin 2>/dev/null || echo "masked"', { timeout: 10000 });
    if (stdout.trim() === 'masked') {
      // Already hardened — verify the others too
      const { stdout: clamResult } = await ssh.exec('systemctl is-enabled clamav-daemon 2>/dev/null || echo "masked"', { timeout: 10000 });
      const { stdout: f2bResult } = await ssh.exec('systemctl is-enabled fail2ban 2>/dev/null || echo "masked"', { timeout: 10000 });
      if (clamResult.trim() === 'masked' && f2bResult.trim() === 'masked') {
        return; // All already hardened
      }
    }
  } catch {
    // Proceed with hardening
  }

  // === SpamAssassin 3-layer kill (Hard Lesson #3) ===

  // Layer 1: Per-domain disable — disable antispam for all mail domains
  try {
    const { stdout: domainsOutput } = await ssh.exec(
      'v-list-mail-domains admin plain 2>/dev/null | awk \'{print $1}\'',
      { timeout: 10000 }
    );
    const mailDomains = domainsOutput.split('\n').map((d) => d.trim()).filter(Boolean);
    for (const d of mailDomains) {
      await ssh.exec(`${HESTIA_PATH_PREFIX}v-change-mail-domain-antispam admin ${d} disabled`, { timeout: 10000 }).catch(() => {});
    }
  } catch {
    // No mail domains yet — skip per-domain disable
  }

  // Layer 2: Config override — set ENABLE_SPAMASSASSIN=no in Exim config
  await ssh.exec(
    'sed -i \'s/ENABLE_SPAMASSASSIN=yes/ENABLE_SPAMASSASSIN=no/g\' /etc/default/exim4 2>/dev/null || true',
    { timeout: 10000 }
  );

  // Layer 3: Systemctl stop + disable + mask
  await ssh.exec(
    'systemctl stop spamassassin 2>/dev/null; systemctl disable spamassassin 2>/dev/null; systemctl mask spamassassin 2>/dev/null',
    { timeout: 15000 }
  );

  // === ClamAV kill (Hard Lesson #15: freshclam ALSO needs masking) ===
  await ssh.exec(
    'systemctl stop clamav-daemon 2>/dev/null; systemctl disable clamav-daemon 2>/dev/null; systemctl mask clamav-daemon 2>/dev/null',
    { timeout: 15000 }
  );
  await ssh.exec(
    'systemctl stop clamav-freshclam 2>/dev/null; systemctl disable clamav-freshclam 2>/dev/null; systemctl mask clamav-freshclam 2>/dev/null',
    { timeout: 15000 }
  );

  // === Fail2ban kill (Hard Lesson #14: stop + disable + mask, all three in order) ===
  await ssh.exec(
    'systemctl stop fail2ban 2>/dev/null; systemctl disable fail2ban 2>/dev/null; systemctl mask fail2ban 2>/dev/null',
    { timeout: 15000 }
  );
}

// ============================================
// g) Issue SSL certificates
// ============================================

/**
 * Pre-flight check: read HestiaCP's LE log files to detect if Let's Encrypt
 * rate-limited a prior attempt for this domain. The rate limit is per-identifier
 * with a 7-day window, so once we hit it, retrying is pointless until the
 * retry-after timestamp. Failing fast here saves the 3-attempt × 30s retry budget
 * when the real issue is "LE said no and won't say yes for X hours".
 *
 * The log format (HestiaCP writes ACME responses to /var/log/hestia/LE-*.log):
 *   "type": "urn:ietf:params:acme:error:rateLimited",
 *   "detail": "...retry after 2026-04-18 05:57:46 UTC: see https://..."
 *
 * Returns { rateLimited: false } if no relevant log exists or the retry-after
 * has passed. Returns { rateLimited: true, retryAfter, message } if a future
 * retry-after is found — caller should throw `LE_RATE_LIMIT: ${message}`.
 */
export async function checkLERateLimit(
  ssh: SSHManager,
  domain: string
): Promise<{ rateLimited: boolean; retryAfter?: Date; message?: string }> {
  try {
    const escaped = domain.replace(/\./g, '\\.');
    const { stdout: fileList } = await ssh.exec(
      `ls /var/log/hestia/ 2>/dev/null | grep -E "^LE-.*${escaped}" || true`,
      { timeout: 10000 }
    );
    const files = fileList.trim().split('\n').filter(Boolean);
    if (files.length === 0) return { rateLimited: false };

    for (const file of files) {
      const { stdout: content } = await ssh.exec(
        `tail -100 /var/log/hestia/${file} 2>/dev/null || true`,
        { timeout: 10000 }
      );

      // Look for ACME rateLimited response with retry-after timestamp
      if (!content.includes('rateLimited')) continue;

      const retryMatch = content.match(
        /retry after (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC/
      );
      if (!retryMatch) continue;

      const isoString = `${retryMatch[1]}T${retryMatch[2]}Z`;
      const retryAfter = new Date(isoString);
      if (isNaN(retryAfter.getTime())) continue;
      if (retryAfter.getTime() <= Date.now()) continue;

      const hoursRemaining = Math.ceil(
        (retryAfter.getTime() - Date.now()) / 3600000
      );
      return {
        rateLimited: true,
        retryAfter,
        message:
          `LE rate limit active for ${domain} (per ${file}). ` +
          `Retry after ${retryAfter.toISOString()} (~${hoursRemaining}h from now). ` +
          `Cause: too many duplicate cert requests in the last 7 days — this usually ` +
          `means the same domain was provisioned repeatedly. Wait for the retry window, ` +
          `use a fresh domain, or switch HestiaCP to LE staging for testing.`,
      };
    }

    return { rateLimited: false };
  } catch {
    // If we can't read logs (e.g., SSH error), proceed — LE call itself will fail
    return { rateLimited: false };
  }
}

/**
 * Issue Let's Encrypt SSL certificate for a domain or hostname.
 *
 * HL #117: v-add-letsencrypt-host requires full PATH + explicit admin arg.
 * HL #118: v-add-letsencrypt-domain requires v-add-web-domain to exist first.
 */
export async function issueSSLCert(
  ssh: SSHManager,
  params: IssueSSLCertParams
): Promise<IssueSSLCertResult> {
  const { domain, isHostname } = params;

  // Check if cert already exists with correct CN (idempotent)
  try {
    const { stdout } = await ssh.exec(
      `openssl x509 -in /etc/ssl/certs/ssl-cert-snakeoil.pem -noout -subject 2>/dev/null || echo ""`,
      { timeout: 10000 }
    );
    // This checks the default cert — real LE cert check below
  } catch {
    // Proceed
  }

  if (isHostname) {
    // Issue hostname cert: v-add-letsencrypt-host
    // HL #117: Use full PATH + explicit 'admin' arg + bash -lc for login shell
    await ssh.exec(`bash -lc "${HESTIA_FULL_PATH} && v-add-letsencrypt-host admin"`, { timeout: 120000 });
  } else {
    // Issue domain cert: v-add-letsencrypt-domain
    // HL #118: Ensure v-add-web-domain exists first (required by HestiaCP)
    // Treat exit 4 (already exists) as non-fatal
    try {
      await ssh.exec(`bash -lc "${HESTIA_FULL_PATH} && v-add-web-domain admin ${domain}"`, { timeout: 120000 });
    } catch (err: unknown) {
      const exitCode = (err as any)?.code;
      if (exitCode !== 4) {
        throw err;
      }
      // exit 4 = already exists, continue
    }

    // Pre-flight: fail fast if LE rate-limited this domain recently
    const rateLimit = await checkLERateLimit(ssh, domain);
    if (rateLimit.rateLimited) {
      throw new Error(`LE_RATE_LIMIT: ${rateLimit.message}`);
    }

    // Issue TWO LE certs (HL #104, Session 04d):
    //   1. Web vhost cert — SAN [{domain}, www.{domain}]. HestiaCP installs it
    //      on the web vhost nginx config so `https://{domain}/` serves a valid
    //      cert. Click-tracking links, unsubscribe URLs, and the MTA-STS policy
    //      file at `https://mta-sts.{domain}/` all need this.
    //   2. Mail cert — SAN [mail.{domain}, webmail.{domain}]. HestiaCP installs
    //      it on Exim4/Dovecot/Roundcube. The VG2 SSL checks probe
    //      `mail.{domain}:443` (HL #99).
    //
    // The old single call `v-add-letsencrypt-domain admin {d} '' yes` issued
    // ONLY the mail cert (the `yes` flag is the MAIL subdomain toggle). The
    // bare web vhost ended up with SSL disabled — `https://{d}/` fell back to
    // the default_server cert (`mail{1|2}.{nsDomain}`), producing CN mismatch
    // warnings on every click-tracking/unsubscribe URL. Session 04d pair 13
    // needed operational backfill; from this PR forward, the saga ships both.
    //
    // Pass '' for aliases on BOTH calls to prevent accidental www/mail double-
    // binding in the SAN set — HestiaCP decides SAN composition from the MAIL
    // flag, not the aliases string.
    const webResult = await ssh.exec(
      `bash -lc "${HESTIA_FULL_PATH} && v-add-letsencrypt-domain admin ${domain}"`,
      { timeout: 120000 }
    );
    const webExit = (webResult as { code?: number }).code;
    if (webExit !== undefined && webExit !== 0 && webExit !== 3 && webExit !== 4) {
      throw new Error(`v-add-letsencrypt-domain (web cert) exited ${webExit} for ${domain}: ${(webResult as { stderr?: string }).stderr ?? ''}`);
    }

    // Mail cert — kept as separate call so a mail-cert issuance failure does
    // not roll back a successful web cert. Exit 3/4 tolerated ("already exists").
    const mailResult = await ssh.exec(
      `bash -lc "${HESTIA_FULL_PATH} && v-add-letsencrypt-domain admin ${domain} '' yes"`,
      { timeout: 120000 }
    );
    const mailExit = (mailResult as { code?: number }).code;
    if (mailExit !== undefined && mailExit !== 0 && mailExit !== 3 && mailExit !== 4) {
      throw new Error(`v-add-letsencrypt-domain (mail cert) exited ${mailExit} for ${domain}: ${(mailResult as { stderr?: string }).stderr ?? ''}`);
    }
  }

  // Verify CN matches expected
  let cn = '';
  try {
    const certCheckCmd = isHostname
      ? `hostname -f`
      : `echo "${domain}"`;
    const { stdout: expectedHost } = await ssh.exec(certCheckCmd, { timeout: 10000 });

    // Check the actual cert CN
    const certPath = isHostname
      ? '/usr/local/hestia/ssl/certificate.crt'
      : `/home/admin/conf/web/${domain}/ssl/${domain}.crt`;

    const { stdout: certSubject } = await ssh.exec(
      `openssl x509 -in ${certPath} -noout -subject 2>/dev/null || echo "CN=unknown"`,
      { timeout: 10000 }
    );

    const cnMatch = certSubject.match(/CN\s*=\s*([^\s/,]+)/);
    cn = cnMatch ? cnMatch[1] : expectedHost.trim();
  } catch {
    cn = domain;
  }

  return { success: true, cn };
}

/**
 * HL #123 (Test #15, 2026-04-11): cluster cert race.
 *
 * When both servers in a HestiaCP DNS cluster try to issue a Let's
 * Encrypt cert for the same sending domain via HTTP-01, they each
 * generate a DIFFERENT ACME account key and write a DIFFERENT challenge
 * file. The sending domain's A record points to BOTH server IPs, so
 * Let's Encrypt's validator round-robins. Whichever request lands on
 * the "wrong" server returns 403 with:
 *
 *   "The key authorization file from the server did not match this
 *    challenge. Expected ... (got ...)"
 *
 * The cleanest fix is to issue ONCE on the primary (S1), then
 * replicate the cert files from S1 → S2 over SSH and rebuild S2's
 * mail/web domain so it picks them up. S2 doesn't need to talk to
 * Let's Encrypt at all for sending domains.
 *
 * This function is called from the security_hardening saga step
 * AFTER `issueSSLCert(ssh1, { domain, isHostname: false })` succeeds.
 *
 * It expects the cert to live at the canonical Hestia paths on S1:
 *   /home/admin/conf/web/{domain}/ssl/{domain}.{crt,key,ca,pem}
 * and writes them to the same paths on S2 (creating the dir tree if
 * v-add-web-domain hasn't created it yet on S2 — which we trigger
 * defensively before the copy).
 */
export async function replicateSSLCertToSecondary(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string
): Promise<void> {
  // 1. Make sure the web domain exists on S2 so Hestia knows where to
  //    drop the cert files. Exit code 4 = already exists, ignore.
  try {
    await ssh2.exec(
      `bash -lc "${HESTIA_FULL_PATH} && v-add-web-domain admin ${domain}"`,
      { timeout: 60000 }
    );
  } catch (err: unknown) {
    const exitCode = (err as { code?: number })?.code;
    if (exitCode !== 4) {
      throw new Error(
        `replicateSSLCertToSecondary: v-add-web-domain failed on S2 for ${domain}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 2. Read each cert file from S1 as base64. base64 dodges all the
  //    quoting / newline / heredoc grief that bites real-world cert
  //    transfer scripts.
  const certDir = `/home/admin/conf/web/${domain}/ssl`;
  const files = [`${domain}.crt`, `${domain}.key`, `${domain}.ca`, `${domain}.pem`];

  // Make sure the dest directory exists on S2 (v-add-web-domain
  // usually creates it, but be paranoid).
  await ssh2.exec(`mkdir -p ${certDir} && chown admin:admin ${certDir}`, {
    timeout: 10000,
  });

  for (const file of files) {
    const srcPath = `${certDir}/${file}`;
    let b64Content: string;
    try {
      const { stdout } = await ssh1.exec(
        `if [ -f ${srcPath} ]; then base64 -w0 ${srcPath}; else echo MISSING; fi`,
        { timeout: 15000 }
      );
      b64Content = stdout.trim();
    } catch (err) {
      throw new Error(
        `replicateSSLCertToSecondary: failed reading ${srcPath} on S1: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (b64Content === "MISSING" || !b64Content) {
      // .ca / .pem may not exist if Hestia version doesn't generate
      // them — skip those, but .crt / .key are mandatory.
      if (file.endsWith(".crt") || file.endsWith(".key")) {
        throw new Error(
          `replicateSSLCertToSecondary: required cert file ${srcPath} missing on S1 — issueSSLCert must have failed silently`
        );
      }
      continue;
    }
    // Write to S2 via tee, then chown to admin so Hestia can read it.
    try {
      await ssh2.exec(
        `echo '${b64Content}' | base64 -d > ${certDir}/${file} && chown admin:admin ${certDir}/${file} && chmod 600 ${certDir}/${file}`,
        { timeout: 15000 }
      );
    } catch (err) {
      throw new Error(
        `replicateSSLCertToSecondary: failed writing ${certDir}/${file} on S2: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 3. Rebuild the web + mail domain on S2 so it picks up the new
  //    cert files. v-rebuild-web-domain regenerates nginx/apache
  //    confs; v-rebuild-mail-domain regenerates exim's TLS config.
  // PATCH 6: these were silently catching errors before. If the rebuild
  // fails, the cert files are on disk but Exim/nginx never load them —
  // a silent false-green. Fail fast instead.
  try {
    await ssh2.exec(
      `bash -lc "${HESTIA_FULL_PATH} && v-rebuild-web-domain admin ${domain}"`,
      { timeout: 60000 }
    );
  } catch (err) {
    throw new Error(
      `replicateSSLCertToSecondary: v-rebuild-web-domain failed on S2 for ${domain}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  try {
    await ssh2.exec(
      `bash -lc "${HESTIA_FULL_PATH} && v-rebuild-mail-domain admin ${domain}"`,
      { timeout: 60000 }
    );
  } catch (err) {
    throw new Error(
      `replicateSSLCertToSecondary: v-rebuild-mail-domain failed on S2 for ${domain}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 4. End-of-step verification: read cert CN from S2 and confirm it
  //    matches the domain we just replicated. If openssl can't parse
  //    the file, the write or rebuild broke something we need to know.
  try {
    const { stdout: certSubject } = await ssh2.exec(
      `openssl x509 -in ${certDir}/${domain}.crt -noout -subject 2>/dev/null || echo "CN=UNVERIFIED"`,
      { timeout: 10000 }
    );
    if (!certSubject || /UNVERIFIED/.test(certSubject)) {
      throw new Error(
        `replicateSSLCertToSecondary: openssl could not parse cert on S2 for ${domain}`
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `[replicateSSLCertToSecondary] ${domain}: S2 cert loaded — ${certSubject.trim()}`
    );
  } catch (err) {
    throw new Error(
      `replicateSSLCertToSecondary: S2 cert verification failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ============================================
// g.2) Replicate DKIM private/public keys S1 -> S2
// ============================================
/**
 * HL #124 (Test #15, 2026-04-11): HestiaCP's v-add-mail-domain-dkim
 * generates a FRESH RSA keypair on each server it's run on. When createMailDomain
 * runs on both s1 and s2, each server ends up with a DIFFERENT private key,
 * but the DNS TXT record mail._domainkey.<domain> only contains s1's public key.
 * Any outbound mail that Exim on s2 signs will fail DKIM validation at the
 * receiving MTA because the receiver compares s2's signature against s1's
 * published public key.
 *
 * HL #126 (Test #16 canary, 2026-04-11): The ORIGINAL PATCH 4 shipped
 * with the WRONG PATHS. It looked for /etc/exim4/domains/<d>/dkim.private.pem
 * and /etc/exim4/domains/<d>/dkim.public.pem — but HestiaCP doesn't use those
 * filenames. The actual paths HestiaCP writes are:
 *   1. /home/admin/conf/mail/<d>/dkim.pem          ← the Exim-readable private key
 *      (same file visible as /etc/exim4/domains/<d>/dkim.pem via Hestia's
 *      symlink/bind-mount; Exim's exim4.conf.template: DKIM_FILE = /etc/exim4/domains/${...}/dkim.pem)
 *   2. /usr/local/hestia/data/users/admin/mail/<d>.pem   ← Hestia metadata (private)
 *   3. /usr/local/hestia/data/users/admin/mail/<d>.pub   ← Hestia metadata (public)
 *
 * PATCH 5 (this function) writes ALL THREE on s2 so both (a) Exim signs with
 * the same key s1 published in DNS and (b) v-rebuild-mail-domain doesn't
 * overwrite from stale Hestia metadata. Ownership: dkim.pem is
 * Debian-exim:mail 660; the hestia metadata files are root:root 660.
 *
 * After replication we v-rebuild-mail-domain on s2 then restart exim4 so the
 * new key is loaded into Exim's DKIM_FILE cache.
 *
 * Best-effort: if s1's dkim.pem is missing, log a warning and return. The
 * worst case is that s2 keeps its own fresh key and we eat a DKIM mismatch
 * on s2-signed mail, but the pair still ships.
 */
export async function replicateDKIMKeysToSecondary(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string
): Promise<void> {
  // (1) Exim-readable private key — THIS is what Exim actually signs with.
  const eximDkimPath = `/home/admin/conf/mail/${domain}/dkim.pem`;
  // (2) + (3) Hestia metadata so v-rebuild doesn't overwrite from stale source.
  const hestiaPrivPath = `/usr/local/hestia/data/users/admin/mail/${domain}.pem`;
  const hestiaPubPath = `/usr/local/hestia/data/users/admin/mail/${domain}.pub`;

  // Files to replicate: [src_path, dst_path, chown, chmod]
  const files: Array<[string, string, string, string]> = [
    [eximDkimPath, eximDkimPath, 'Debian-exim:mail', '660'],
    [hestiaPrivPath, hestiaPrivPath, 'root:root', '660'],
    [hestiaPubPath, hestiaPubPath, 'root:root', '660'],
  ];

  let replicated = 0;
  for (const [srcPath, dstPath, own, mode] of files) {
    let b64Content: string;
    try {
      const { stdout } = await ssh1.exec(
        `if [ -f ${srcPath} ]; then base64 -w0 ${srcPath}; else echo MISSING; fi`,
        { timeout: 15000 }
      );
      b64Content = (stdout || '').trim();
    } catch (err) {
      // Read failure on S1 is fatal for the critical file, non-fatal
      // for hestia metadata (which we can fix via v-rebuild-mail-domain).
      if (srcPath === eximDkimPath) {
        throw new Error(
          `[replicateDKIMKeysToSecondary] CRITICAL: read ${srcPath} on S1 failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[replicateDKIMKeysToSecondary] read ${srcPath} on S1 failed (non-critical, metadata): ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    if (b64Content === 'MISSING' || !b64Content) {
      if (srcPath === eximDkimPath) {
        throw new Error(
          `[replicateDKIMKeysToSecondary] CRITICAL: ${srcPath} not present on S1 for ${domain} — DKIM will mismatch. Fail fast (HL #126).`
        );
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[replicateDKIMKeysToSecondary] ${srcPath} not present on S1 for ${domain} — skipping (non-critical metadata)`
      );
      continue;
    }

    const dstDir = dstPath.substring(0, dstPath.lastIndexOf('/'));
    try {
      await ssh2.exec(
        `mkdir -p ${dstDir} && echo '${b64Content}' | base64 -d > ${dstPath} && chown ${own} ${dstPath} && chmod ${mode} ${dstPath}`,
        { timeout: 15000 }
      );
      replicated += 1;
    } catch (err) {
      // PATCH 6 (HL #126 follow-up): write failures on S2 are
      // fatal for the critical file — do NOT silently continue.
      if (srcPath === eximDkimPath) {
        throw new Error(
          `[replicateDKIMKeysToSecondary] CRITICAL: write ${dstPath} on S2 failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[replicateDKIMKeysToSecondary] write ${dstPath} on S2 failed (non-critical metadata): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (replicated === 0) {
    throw new Error(
      `[replicateDKIMKeysToSecondary] ${domain}: CRITICAL — no files replicated S1→S2.`
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[replicateDKIMKeysToSecondary] ${domain}: ${replicated}/${files.length} files replicated S1→S2`
  );

  // Rebuild the mail domain on s2 so Hestia reconciles the metadata,
  // then restart exim4 so the new DKIM_FILE is picked up.
  // PATCH 6: rebuild failures are fatal — silent catch masked bugs previously.
  try {
    await ssh2.exec(
      `bash -lc "${HESTIA_FULL_PATH} && v-rebuild-mail-domain admin ${domain}"`,
      { timeout: 60000 }
    );
  } catch (err) {
    throw new Error(
      `[replicateDKIMKeysToSecondary] v-rebuild-mail-domain failed on S2 for ${domain}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  try {
    await ssh2.exec(`systemctl restart exim4`, { timeout: 30000 });
  } catch (err) {
    throw new Error(
      `[replicateDKIMKeysToSecondary] exim4 restart failed on S2 for ${domain}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Verification — sha256sum s1 vs s2 on the Exim-readable path.
  // PATCH 6: mismatch is now FATAL (was warning-only). If this throws,
  // step 6 fails and the job is marked failed instead of false-greened.
  let h1 = '';
  let h2 = '';
  try {
    const { stdout: h1raw } = await ssh1.exec(
      `sha256sum ${eximDkimPath} | cut -d' ' -f1`,
      { timeout: 10000 }
    );
    const { stdout: h2raw } = await ssh2.exec(
      `sha256sum ${eximDkimPath} | cut -d' ' -f1`,
      { timeout: 10000 }
    );
    h1 = (h1raw || '').trim();
    h2 = (h2raw || '').trim();
  } catch (err) {
    throw new Error(
      `[replicateDKIMKeysToSecondary] ${domain}: verification sha256sum failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!h1 || !h2 || h1 !== h2) {
    throw new Error(
      `[replicateDKIMKeysToSecondary] ${domain}: DKIM mismatch S1↔S2 after replication (s1=${h1}, s2=${h2})`
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `[replicateDKIMKeysToSecondary] ${domain}: DKIM match S1↔S2 (${h1})`
  );
}

// ============================================
// h) Set server hostname
// ============================================

/**
 * Set the server hostname via HestiaCP.
 *
 * Hard Lesson #5: Use mail.X format for hostnames, never panel.*
 * Hard Lesson #1: Never share a hostname between two servers
 */
export async function setHostname(ssh: SSHManager, hostname: string): Promise<void> {
  // Set hostname via HestiaCP
  await ssh.exec(`${HESTIA_PATH_PREFIX}v-change-sys-hostname ${hostname}`, { timeout: 30000 });

  // Verify with hostname -f
  const { stdout } = await ssh.exec('hostname -f', { timeout: 10000 });
  const actualHostname = stdout.trim();

  if (actualHostname !== hostname) {
    throw new Error(
      `Hostname mismatch: expected "${hostname}", got "${actualHostname}". ` +
      `May need to update /etc/hosts manually.`
    );
  }
}

// ============================================
// h) Zone replication via BIND AXFR/NOTIFY (HL #101, Session 04d)
//
// The HestiaCP DNS cluster is non-functional (#16a). Prior approach was
// dual-primary: both servers ran `type master` for the same zones and
// attempted record-by-record replication via v-add-dns-record — which drifts
// SOA serials (#46), never syncs DKIM (#2), and exhibits random write
// conflicts when both sides edit concurrently.
//
// Session 04d Option A resolution: per-pair zone ownership partition.
// Each zone has ONE primary server; the peer runs `type slave` and pulls
// via AXFR on the primary's `also-notify` trigger. allow-transfer is scoped
// to the peer IP only, so the zone is not world-transferable.
//
// Partition rule: alphabetical sort by sending domain, split at ceil(N/2).
// NS domain always lives on S1 primary (by convention — S1 is created first
// and holds the registrar glue). Partition is idempotent across re-runs.
// ============================================

export function computeZonePartition(
  nsDomain: string,
  sendingDomains: string[],
): { s1Primary: string[]; s2Primary: string[] } {
  const sorted = [...sendingDomains].sort();
  const midpoint = Math.ceil(sorted.length / 2);
  return {
    s1Primary: [nsDomain, ...sorted.slice(0, midpoint)],
    s2Primary: sorted.slice(midpoint),
  };
}

/**
 * Set `allow-transfer` and `also-notify` GLOBALLY in /etc/bind/named.conf.options,
 * scoped to the peer IP. These act as defaults for every master zone on this
 * server (per-zone overrides win, but Hestia doesn't write per-zone options).
 *
 * HL #105 (Session 04d): Per-zone stanzas in /etc/bind/named.conf are NOT
 * durable. HestiaCP's `v-add-letsencrypt-domain`, `v-add-dns-record`, and
 * `v-rebuild-dns-domain` regenerate each zone stanza from a template that
 * emits the bare `{type master; file "...";};` form — any per-zone
 * allow-transfer/also-notify added via sed is wiped on the next operation.
 * HestiaCP does NOT touch /etc/bind/named.conf.options (only on the user-
 * triggered `v-change-sys-service-config bind9-opt` path). Put cluster-wide
 * BIND policy there.
 *
 * Replaces the HestiaCP default `allow-transfer {"none";};` with a peer-IP-
 * scoped allow list and adds `also-notify` so record changes on any master
 * zone automatically propagate via AXFR to the peer.
 *
 * Uses `rndc reconfig` (not `reload`) — options-block changes need a
 * configuration re-parse; `reload` only reloads zones.
 */
export async function setGlobalZoneTransferPolicy(
  ssh: SSHManager,
  peerIP: string,
): Promise<void> {
  // Idempotent: if the peer-IP allow-transfer is already present, sed is a no-op.
  await ssh.exec(
    `sed -i 's|allow-transfer {"none";};|allow-transfer { ${peerIP}; };\\n        also-notify { ${peerIP}; };|' /etc/bind/named.conf.options`,
    { timeout: 10000 }
  );
  await ssh.exec('rndc reconfig', { timeout: 10000 }).catch(() => {});
}

/**
 * Install slave zones on the peer server via a separate
 * /etc/bind/named.conf.cluster include file, then trigger initial AXFR.
 *
 * Why a separate include file (Approach B): HestiaCP writes zone stanzas
 * directly to /etc/bind/named.conf via shell scripts (not via a user-editable
 * template). Editing the generated file is fragile — v-add-dns-domain rewrites
 * parts of it. A sibling include file with only-slave stanzas is orthogonal:
 * HestiaCP never touches it, and the `include` directive is appended once
 * (idempotent).
 *
 * The caller must have already removed the zone from HestiaCP on this server
 * (via v-delete-dns-domain) so that the only stanza for each zone is the
 * slave form in the cluster file — BIND errors on duplicate zone definitions.
 */
export async function installSlaveZones(
  ssh: SSHManager,
  zones: string[],
  primaryIP: string,
): Promise<void> {
  if (zones.length === 0) return;

  await ssh.exec(
    'mkdir -p /var/cache/bind/slaves && chown bind:bind /var/cache/bind/slaves',
    { timeout: 10000 }
  );

  const stanzas = zones
    .map(
      (z) =>
        `zone "${z}" { type slave; masters { ${primaryIP}; }; file "slaves/${z}.db"; allow-transfer { none; }; };`
    )
    .join('\n');

  const fileContent = `// Slave zones — primary on peer server (Session 04d, HL #101 AXFR/NOTIFY)\n${stanzas}\n`;

  // Write cluster file via base64 to avoid heredoc/quote escaping pitfalls.
  const b64 = Buffer.from(fileContent, 'utf8').toString('base64');
  await ssh.exec(
    `echo '${b64}' | base64 -d > /etc/bind/named.conf.cluster`,
    { timeout: 10000 }
  );

  // Ensure named.conf includes the cluster file — idempotent.
  await ssh.exec(
    `grep -q 'named.conf.cluster' /etc/bind/named.conf || echo 'include "/etc/bind/named.conf.cluster";' >> /etc/bind/named.conf`,
    { timeout: 10000 }
  );

  await ssh.exec('rndc reload', { timeout: 10000 });

  // Trigger initial AXFR for each slave zone (also-notify from primary covers
  // future changes, but the slave needs at least one transfer to populate).
  for (const zone of zones) {
    await ssh.exec(`rndc retransfer ${zone}`, { timeout: 5000 }).catch(() => {});
  }
}

/**
 * Ensure port 53 TCP + UDP is open to the peer server only (not world).
 *
 * Current deployment: /etc/iptables/rules.v4 on Hestia servers already has
 * `-A INPUT -p tcp --dport 53 -j ACCEPT` and `-A INPUT -p udp --dport 53`
 * unconditionally (world-open, to serve authoritative DNS). This helper is
 * therefore a no-op on the existing infrastructure — AXFR inherits from the
 * global rule. Retained as an explicit peer-scoped rule for future pairs
 * where a stricter firewall policy may be applied.
 */
export async function openBindFirewall(
  ssh: SSHManager,
  peerIP: string,
): Promise<void> {
  const rules = [
    `iptables -C INPUT -p tcp -s ${peerIP} --dport 53 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp -s ${peerIP} --dport 53 -j ACCEPT`,
    `iptables -C INPUT -p udp -s ${peerIP} --dport 53 -j ACCEPT 2>/dev/null || iptables -I INPUT -p udp -s ${peerIP} --dport 53 -j ACCEPT`,
  ];
  for (const rule of rules) {
    await ssh.exec(rule, { timeout: 5000 }).catch(() => {});
  }
  // Persist (netfilter-persistent service is standard on Ubuntu + HestiaCP)
  await ssh.exec('netfilter-persistent save 2>/dev/null || iptables-save > /etc/iptables/rules.v4 2>/dev/null || true', { timeout: 5000 });
}

// ============================================
// i) Unmask and start Exim4 + Dovecot
// Called by Step 6 AFTER all auth records (SPF, DKIM, DMARC) are in place
// and PTR has been set (Step 5). This ensures Exim4 never listens on port 25
// until the server can send fully-authenticated email.
// Hard Lesson #84: Exim4 must not run until auth is ready.
// ============================================
export async function unmaskExim4(ssh: SSHManager): Promise<void> {
  await ssh.exec(
    'systemctl unmask exim4 && systemctl start exim4 && systemctl unmask dovecot && systemctl start dovecot',
    { timeout: 15000 }
  );
  // Verify Exim4 is actually running
  const { stdout } = await ssh.exec('systemctl is-active exim4', { timeout: 5000 });
  if (!stdout.trim().includes('active')) {
    throw new Error('Exim4 failed to start after unmask');
  }
}
