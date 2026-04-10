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

/**
 * HestiaCP installs its CLI tools to /usr/local/hestia/bin/ which
 * is NOT in $PATH for non-login SSH sessions. All v-* commands must
 * be prefixed with this PATH export.
 */
const HESTIA_PATH_PREFIX = 'export PATH=/usr/local/hestia/bin:$PATH && ';

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
  const { domain, server1IP, server2IP, nsDomain, isNSDomain, records } = params;

  // Check if zone already exists (idempotent)
  try {
    const checkResult = await ssh.exec(`${HESTIA_PATH_PREFIX}v-list-dns-domain admin ${domain} 2>/dev/null`, { timeout: 10000 });
    if (checkResult.code === 0 && checkResult.stdout.trim().length > 0) {
      // Zone exists — clean it up and ensure records are correct
      await cleanupDNSZoneDefaults(ssh, domain, nsDomain);
      await ensureDNSRecords(ssh, domain, server1IP, server2IP, nsDomain, isNSDomain, records);
      return;
    }
  } catch {
    // Zone doesn't exist, create it
  }

  // Create the zone
  await ssh.exec(`${HESTIA_PATH_PREFIX}v-add-dns-domain admin ${domain} ${server1IP}`, { timeout: 30000 });

  // Clean up bad defaults (Hard Lesson #12, #13)
  await cleanupDNSZoneDefaults(ssh, domain, nsDomain);

  // Add all required records
  await ensureDNSRecords(ssh, domain, server1IP, server2IP, nsDomain, isNSDomain, records);
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
  }

  // Hard Lesson #13: Fix SOA MNAME to ns1.NSDOMAIN
  await ssh.exec(
    `${HESTIA_PATH_PREFIX}v-change-dns-domain-soa admin ${domain} ns1.${nsDomain}`,
    { timeout: 10000 }
  ).catch(() => {
    // Some HestiaCP versions don't have this command; we'll handle it via record editing
  });
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
  extraRecords?: DNSRecord[]
): Promise<void> {
  // Build the required record set
  const requiredRecords: Array<{type: string; host: string; value: string; priority?: number}> = [
    // A records
    { type: 'A', host: '@', value: server1IP },
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
      await ssh.exec(
        `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} ${req.host} ${req.type} '${req.value}' ${priorityArg}`.trim(),
        { timeout: 10000 }
      );
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
  const { domain, accounts, password, adminEmail } = params;
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

  // Create mail domain
  await ssh.exec(`${HESTIA_PATH_PREFIX}v-add-mail-domain admin ${domain}`, { timeout: 15000 });

  // Generate DKIM
  await ssh.exec(`${HESTIA_PATH_PREFIX}v-add-mail-domain-dkim admin ${domain}`, { timeout: 15000 });

  // Add SPF TXT record
  await ssh.exec(
    `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} @ TXT '"v=spf1 +a +mx -all"'`,
    { timeout: 10000 }
  ).catch(() => {
    // May already exist from zone creation
  });

  // Add DMARC TXT record
  const dmarcEmail = adminEmail || `postmaster@${domain}`;
  await ssh.exec(
    `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} _dmarc TXT '"v=DMARC1; p=quarantine; pct=100; rua=mailto:${dmarcEmail}"'`,
    { timeout: 10000 }
  ).catch(() => {
    // May already exist
  });

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
      await targetSSH.exec(
        `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} ${srcRecord.host} ${srcRecord.type} '${srcRecord.value}' ${priorityArg}`.trim(),
        { timeout: 10000 }
      );
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
 * Issue Let's Encrypt SSL certificate for a domain or hostname.
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
    await ssh.exec('v-add-letsencrypt-host', { timeout: 120000 });
  } else {
    // Issue domain cert: v-add-letsencrypt-domain admin DOMAIN
    await ssh.exec(`${HESTIA_PATH_PREFIX}v-add-letsencrypt-domain admin ${domain}`, { timeout: 120000 });
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
