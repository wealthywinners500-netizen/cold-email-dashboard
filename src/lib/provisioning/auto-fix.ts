import type { SSHManager } from './ssh-manager';
import type { VerificationResult, VPSProvider } from './types';
import { HESTIA_PATH_PREFIX, HESTIA_FULL_PATH, checkLERateLimit } from './hestia-scripts';

/**
 * Auto-fix module for cold email server provisioning.
 * Reads verification results and applies automated fixes for auto_fixable issues.
 *
 * Two-phase execution (Hard Lesson from Test #25 / #26):
 *   Phase 1: DNS record fixes (DMARC, SPF, CAA, MX, A records, DKIM, etc.)
 *   Phase 2: SSL cert issuance (requires public DNS propagation of Phase 1 records)
 *
 * Between phases, a DNS propagation poll waits up to 30 min for public resolvers
 * (8.8.8.8, 1.1.1.1) to see the domains. Without this wait, LE HTTP-01 validation
 * fails because LE queries public DNS which still has stale/NXDOMAIN responses
 * from before NS delegation propagated.
 */

const DNS_PROPAGATION_MAX_MS = 30 * 60 * 1000; // 30 minutes
const DNS_PROPAGATION_POLL_MS = 30 * 1000; // 30 seconds

/**
 * Poll public DNS resolvers until at least one sending domain resolves to
 * the expected IP, proving NS delegation has propagated globally. LE's
 * multi-vantage validation needs this before HTTP-01 can succeed.
 */
async function waitForPublicDNSPropagation(
  ssh: SSHManager,
  domains: string[],
  getExpectedIP: (domain: string) => string,
  log: (msg: string) => void
): Promise<void> {
  if (domains.length === 0) return;

  const testDomain = domains[0];
  const expectedIP = getExpectedIP(testDomain);
  const resolvers = ['8.8.8.8', '1.1.1.1'];
  const start = Date.now();

  log(`[Auto-Fix] Waiting for public DNS propagation (testing ${testDomain} → ${expectedIP} on ${resolvers.join(', ')})...`);

  while (Date.now() - start < DNS_PROPAGATION_MAX_MS) {
    let confirmedCount = 0;
    for (const resolver of resolvers) {
      try {
        const { stdout } = await ssh.exec(
          `dig +short ${testDomain} A @${resolver} 2>/dev/null`,
          { timeout: 10000 }
        );
        const ips = stdout.trim().split('\n').filter(Boolean);
        if (ips.includes(expectedIP)) {
          confirmedCount++;
        }
      } catch {
        // resolver query failed — continue
      }
    }

    if (confirmedCount >= 2) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      log(`[Auto-Fix] DNS propagation confirmed: ${testDomain} → ${expectedIP} visible on ${confirmedCount}/${resolvers.length} public resolvers after ${elapsed}s`);
      return;
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    log(`[Auto-Fix] DNS not propagated yet (${confirmedCount}/${resolvers.length} resolvers see ${testDomain}). Elapsed ${elapsed}s / ${Math.round(DNS_PROPAGATION_MAX_MS / 1000)}s max. Retrying in 30s...`);
    await new Promise(r => setTimeout(r, DNS_PROPAGATION_POLL_MS));
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  log(`[Auto-Fix] WARNING: DNS propagation not confirmed after ${elapsed}s. Proceeding with SSL attempts anyway (they may fail).`);
}

/**
 * Robust DNS record replacement pattern:
 * 1. List all DNS records
 * 2. Delete ALL records matching predicate
 * 3. Verify deletion with re-list
 * 4. Add correct records
 * 5. Verify addition with re-list
 */
async function robustDNSRecordReplace(
  sshConnections: SSHManager[],
  domain: string,
  matchFn: (line: string) => boolean,
  addCommands: string[],
  log: (msg: string) => void,
  label: string
): Promise<void> {
  // Delete on both servers
  for (let i = 0; i < sshConnections.length; i++) {
    const ssh = sshConnections[i];
    const serverName = i === 0 ? 'S1' : 'S2';

    // List records
    const listCmd = `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`;
    const listResult = await ssh.exec(listCmd, { timeout: 10000 });
    if (listResult.code !== 0) {
      throw new Error(`${serverName} Failed to list DNS records for ${domain}: ${listResult.stderr}`);
    }

    const lines = listResult.stdout.trim().split('\n').filter(l => l.length > 0);
    const recordsToDelete = lines.filter(matchFn);

    if (recordsToDelete.length === 0) {
      log(`[Auto-Fix] ${label}/${serverName}: No records to delete for ${domain}`);
    } else {
      log(`[Auto-Fix] ${label}/${serverName}: Found ${recordsToDelete.length} records to delete for ${domain}`);

      // Extract IDs and delete each
      for (const line of recordsToDelete) {
        const parts = line.split(/\s+/);
        const recordId = parts[0];

        if (!recordId) {
          throw new Error(`${serverName} Could not parse record ID from: ${line}`);
        }

        const deleteCmd = `${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${recordId}`;
        const deleteResult = await ssh.exec(deleteCmd, { timeout: 10000 });

        // Hard Lesson #89: NEVER use .catch on DNS deletes — ALWAYS log errors explicitly
        if (deleteResult.code !== 0) {
          const errMsg = `${serverName} Failed to delete DNS record ${recordId} from ${domain}: ${deleteResult.stderr}`;
          log(`[Auto-Fix] ✗ ${label}/${serverName}: ${errMsg}`);
          throw new Error(errMsg);
        }
      }
    }

    // Verify deletion
    const verifyListResult = await ssh.exec(listCmd, { timeout: 10000 });
    if (verifyListResult.code !== 0) {
      throw new Error(`${serverName} Failed to verify DNS records for ${domain}: ${verifyListResult.stderr}`);
    }

    const verifyLines = verifyListResult.stdout.trim().split('\n').filter(l => l.length > 0);
    const stillThere = verifyLines.filter(matchFn);
    if (stillThere.length > 0) {
      throw new Error(
        `${serverName} Verification failed for ${domain}: ${stillThere.length} records still present after delete`
      );
    }

    // Add new records
    for (const addCmd of addCommands) {
      const fullCmd = `${HESTIA_PATH_PREFIX}${addCmd}`;
      const addResult = await ssh.exec(fullCmd, { timeout: 10000 });
      // Hard Lesson #97: HestiaCP exit code 4 = "object already exists" — non-fatal for DNS adds
      // Exit code 3 = "object already exists" for some record types (also non-fatal)
      if (addResult.code !== 0 && addResult.code !== 3 && addResult.code !== 4) {
        throw new Error(
          `${serverName} Failed to add DNS record for ${domain}: ${addResult.stderr || addResult.stdout}`
        );
      }
      if (addResult.code === 3 || addResult.code === 4) {
        log(`[Auto-Fix] ${label}/${serverName}: Record already exists for ${domain} (exit code ${addResult.code}) — continuing`);
      }
    }

    // Verify addition
    const finalListResult = await ssh.exec(listCmd, { timeout: 10000 });
    if (finalListResult.code !== 0) {
      throw new Error(`${serverName} Failed to verify DNS records after add for ${domain}: ${finalListResult.stderr}`);
    }

    const finalLines = finalListResult.stdout.trim().split('\n').filter(l => l.length > 0);
    const nowPresent = finalLines.filter(l => addCommands.some(cmd => l.includes(domain)));
    if (nowPresent.length === 0) {
      log(
        `[Auto-Fix] ${label}/${serverName}: Warning — records added but verification returned no results. Continuing.`
      );
    }

    log(`[Auto-Fix] ${label}/${serverName}: Successfully replaced DNS records for ${domain}`);
  }
}

/**
 * Fix A record: delete all @ A records, add correct one
 */
async function fixARecord(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  serverIP: string,
  server1IP: string,
  server2IP: string,
  params: { nsDomain: string; server1Domains: string[]; server2Domains: string[]; log: (msg: string) => void }
): Promise<void> {
  // Determine correct IP for this domain
  const correctIP = params.server2Domains.includes(domain) ? server2IP : server1IP;

  const addCmd = `v-add-dns-record admin ${domain} @ A ${correctIP}`;
  const matchFn = (line: string) => {
    const parts = line.split(/\s+/);
    return parts[2] === 'A' && parts[1] === '@';
  };

  await robustDNSRecordReplace([ssh1, ssh2], domain, matchFn, [addCmd], params.log, 'fix_a_record');
}

/**
 * Add webmail A and mail A records
 */
async function addWebmailA(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  server1IP: string,
  server2IP: string,
  params: { server1Domains: string[]; server2Domains: string[]; log: (msg: string) => void }
): Promise<void> {
  const correctIP = params.server2Domains.includes(domain) ? server2IP : server1IP;

  const addCommands = [
    `v-add-dns-record admin ${domain} mail A ${correctIP}`,
    `v-add-dns-record admin ${domain} webmail A ${correctIP}`,
  ];

  const matchFn = (line: string) => {
    const parts = line.split(/\s+/);
    const host = parts[1];
    const type = parts[2];
    return type === 'A' && (host === 'mail' || host === 'webmail');
  };

  await robustDNSRecordReplace([ssh1, ssh2], domain, matchFn, addCommands, params.log, 'add_webmail_a');
}

/**
 * Fix MX record: delete all @ MX, add correct one
 */
async function fixMX(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { server1Domains: string[]; server2Domains: string[]; log: (msg: string) => void }
): Promise<void> {
  const isS2 = params.server2Domains.includes(domain);
  const mxHost = isS2 ? `mail2.${domain}` : `mail1.${domain}`;
  const addCmd = `v-add-dns-record admin ${domain} @ MX ${mxHost} 10`;

  const matchFn = (line: string) => {
    const parts = line.split(/\s+/);
    return parts[2] === 'MX' && parts[1] === '@';
  };

  await robustDNSRecordReplace([ssh1, ssh2], domain, matchFn, [addCmd], params.log, 'fix_mx');
}

/**
 * Fix SOA record
 */
async function fixSOA(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { log: (msg: string) => void }
): Promise<void> {
  const cmd = `${HESTIA_PATH_PREFIX}v-change-dns-domain-soa admin ${domain} '' '' 3600 600 604800 3600`;

  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    const result = await ssh.exec(cmd, { timeout: 10000 });
    if (result.code !== 0) {
      throw new Error(`${serverName} Failed to set SOA for ${domain}: ${result.stderr}`);
    }
    params.log(`[Auto-Fix] fix_soa/${serverName}: Set SOA for ${domain}`);
  }
}

/**
 * Fix zone transfer: disable public zone transfers
 */
async function fixZoneTransfer(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { log: (msg: string) => void }
): Promise<void> {
  const cmd = `${HESTIA_PATH_PREFIX}v-change-dns-domain-tp admin ${domain} ''`;

  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    const result = await ssh.exec(cmd, { timeout: 10000 });
    if (result.code !== 0) {
      throw new Error(`${serverName} Failed to disable zone transfer for ${domain}: ${result.stderr}`);
    }
    params.log(`[Auto-Fix] fix_zone_transfer/${serverName}: Disabled zone transfer for ${domain}`);
  }
}

/**
 * Add CAA record
 */
async function addCAA(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { log: (msg: string) => void }
): Promise<void> {
  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    // Check if CAA already exists with letsencrypt.org
    const listResult = await ssh.exec(
      `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
      { timeout: 10000 }
    );
    if (listResult.code === 0) {
      const existingCAA = listResult.stdout.split('\n').find(
        l => l.includes('CAA') && l.includes('letsencrypt')
      );
      if (existingCAA) {
        params.log(`[Auto-Fix] add_caa/${serverName}: CAA record already exists for ${domain} — skipping`);
        continue;
      }
    }

    // Try with quotes first, then without if it fails
    let cmd = `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} @ CAA '0 issue "letsencrypt.org"'`;
    let result = await ssh.exec(cmd, { timeout: 10000 });

    // If failed (not "already exists"), try without quotes
    if (result.code !== 0 && result.code !== 3 && result.code !== 4) {
      cmd = `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} @ CAA 0 issue letsencrypt.org`;
      result = await ssh.exec(cmd, { timeout: 10000 });
    }

    // Hard Lesson #97: exit 3/4 = "already exists" — non-fatal
    if (result.code !== 0 && result.code !== 3 && result.code !== 4) {
      throw new Error(`${serverName} Failed to add CAA record for ${domain}: ${result.stderr}`);
    }
    if (result.code === 3 || result.code === 4) {
      params.log(`[Auto-Fix] add_caa/${serverName}: CAA already exists for ${domain} (exit ${result.code}) — continuing`);
    } else {
      params.log(`[Auto-Fix] add_caa/${serverName}: Added CAA record for ${domain}`);
    }
  }
}

/**
 * Add SPF record
 */
async function addSPF(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  server1IP: string,
  server2IP: string,
  params: { server1Domains: string[]; server2Domains: string[]; log: (msg: string) => void }
): Promise<void> {
  const correctIP = params.server2Domains.includes(domain) ? server2IP : server1IP;
  const spfValue = `"v=spf1 ip4:${correctIP} -all"`;
  const addCmd = `v-add-dns-record admin ${domain} @ TXT ${spfValue}`;

  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    // Check if SPF already exists with correct content
    const listResult = await ssh.exec(
      `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
      { timeout: 10000 }
    );
    if (listResult.code === 0) {
      const existingSPF = listResult.stdout.split('\n').find(
        l => l.includes('TXT') && l.includes('v=spf1') && l.includes(correctIP)
      );
      if (existingSPF) {
        params.log(`[Auto-Fix] add_spf/${serverName}: SPF record already exists for ${domain} — skipping`);
        continue;
      }
    }

    const result = await ssh.exec(`${HESTIA_PATH_PREFIX}${addCmd}`, { timeout: 10000 });
    // Hard Lesson #97: exit 3/4 = "already exists" — non-fatal
    if (result.code !== 0 && result.code !== 3 && result.code !== 4) {
      throw new Error(`${serverName} Failed to add SPF record for ${domain}: ${result.stderr}`);
    }
    if (result.code === 3 || result.code === 4) {
      params.log(`[Auto-Fix] add_spf/${serverName}: SPF already exists for ${domain} (exit ${result.code}) — continuing`);
    } else {
      params.log(`[Auto-Fix] add_spf/${serverName}: Added SPF record for ${domain}`);
    }
  }
}

/**
 * Fix SPF record: delete all SPF TXT records, add correct one
 */
async function fixSPF(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  server1IP: string,
  server2IP: string,
  params: { server1Domains: string[]; server2Domains: string[]; log: (msg: string) => void }
): Promise<void> {
  const correctIP = params.server2Domains.includes(domain) ? server2IP : server1IP;
  const spfValue = `"v=spf1 ip4:${correctIP} -all"`;
  const addCmd = `v-add-dns-record admin ${domain} @ TXT ${spfValue}`;

  const matchFn = (line: string) => {
    return line.includes('TXT') && line.includes('v=spf1');
  };

  await robustDNSRecordReplace([ssh1, ssh2], domain, matchFn, [addCmd], params.log, 'fix_spf');
}

/**
 * Add DKIM record: read from source server, add to both.
 * Hard Lesson #97: exit code 3/4 = "already exists" — non-fatal for DNS adds.
 * Before adding, check if the record already exists with correct content on
 * the target server. If so, skip the add (mark as already fixed).
 */
async function addDKIM(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { server1Domains: string[]; server2Domains: string[]; log: (msg: string) => void }
): Promise<void> {
  // Determine source server
  const sourceSSH = params.server2Domains.includes(domain) ? ssh2 : ssh1;
  const sourceServer = params.server2Domains.includes(domain) ? 'S2' : 'S1';
  const otherSSH = sourceSSH === ssh1 ? ssh2 : ssh1;
  const otherServer = sourceServer === 'S1' ? 'S2' : 'S1';

  // Read DKIM from source server
  const listCmd = `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`;
  const listResult = await sourceSSH.exec(listCmd, { timeout: 10000 });

  if (listResult.code !== 0) {
    throw new Error(`${sourceServer} Failed to list DNS records for ${domain}: ${listResult.stderr}`);
  }

  const lines = listResult.stdout.trim().split('\n').filter(l => l.length > 0);
  let dkimLine = lines.find(l => l.includes('mail._domainkey') && l.includes('TXT'));

  if (!dkimLine) {
    // Try to regenerate DKIM
    params.log(`[Auto-Fix] add_dkim/${sourceServer}: No DKIM found, attempting to regenerate for ${domain}`);
    const genCmd = `${HESTIA_PATH_PREFIX}v-add-mail-domain-dkim admin ${domain}`;
    const genResult = await sourceSSH.exec(genCmd, { timeout: 15000 });

    // Exit 3/4 = already exists (non-fatal)
    if (genResult.code !== 0 && genResult.code !== 3 && genResult.code !== 4) {
      throw new Error(`${sourceServer} Failed to regenerate DKIM for ${domain}: ${genResult.stderr}`);
    }

    // Re-list to get the DKIM
    const relistResult = await sourceSSH.exec(listCmd, { timeout: 10000 });
    if (relistResult.code !== 0) {
      throw new Error(`${sourceServer} Failed to re-list DNS records for ${domain}: ${relistResult.stderr}`);
    }

    const relistLines = relistResult.stdout.trim().split('\n').filter(l => l.length > 0);
    dkimLine = relistLines.find(l => l.includes('mail._domainkey') && l.includes('TXT'));

    if (!dkimLine) {
      throw new Error(`${sourceServer} Failed to find DKIM record even after regeneration for ${domain}`);
    }
  }

  // Extract DKIM value
  const parts = dkimLine.split(/\s+/);
  const dkimValue = parts.slice(3).join(' ');

  // Check if the DKIM record already exists on the other server with correct content
  const otherListResult = await otherSSH.exec(listCmd, { timeout: 10000 });
  if (otherListResult.code === 0) {
    const otherLines = otherListResult.stdout.trim().split('\n').filter(l => l.length > 0);
    const existingDkim = otherLines.find(l => l.includes('mail._domainkey') && l.includes('TXT'));
    if (existingDkim && existingDkim.includes('v=DKIM1')) {
      params.log(`[Auto-Fix] add_dkim/${otherServer}: DKIM record already exists for ${domain} — skipping add`);
      return;
    }
  }

  // Add to other server — tolerate exit 3/4 ("already exists")
  const addCmd = `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} mail._domainkey TXT ${dkimValue}`;
  const addResult = await otherSSH.exec(addCmd, { timeout: 10000 });

  if (addResult.code !== 0 && addResult.code !== 3 && addResult.code !== 4) {
    throw new Error(`${otherServer} Failed to add DKIM record for ${domain}: ${addResult.stderr}`);
  }
  if (addResult.code === 3 || addResult.code === 4) {
    params.log(`[Auto-Fix] add_dkim/${otherServer}: DKIM record already exists for ${domain} (exit ${addResult.code}) — continuing`);
  } else {
    params.log(`[Auto-Fix] add_dkim/${otherServer}: Added DKIM record for ${domain}`);
  }
}

/**
 * Add DMARC record
 */
async function addDMARC(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { log: (msg: string) => void }
): Promise<void> {
  // Hard Lesson #95: No rua= in DMARC — external reporting domain
  // (thestealthmail.com) lacks authorization records for sending domains,
  // causing MXToolbox "External Domains not giving permission" warning.
  const dmarcValue = '"v=DMARC1; p=quarantine; pct=100"';
  const addCmd = `v-add-dns-record admin ${domain} _dmarc TXT ${dmarcValue}`;

  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    // Check if DMARC record already exists with correct content
    const listResult = await ssh.exec(
      `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
      { timeout: 10000 }
    );
    if (listResult.code === 0) {
      const existingDmarc = listResult.stdout.split('\n').find(
        l => l.includes('_dmarc') && l.includes('TXT') && l.includes('v=DMARC1')
      );
      if (existingDmarc) {
        params.log(`[Auto-Fix] add_dmarc/${serverName}: DMARC record already exists for ${domain} — skipping`);
        continue;
      }
    }

    const result = await ssh.exec(`${HESTIA_PATH_PREFIX}${addCmd}`, { timeout: 10000 });
    // Hard Lesson #97: exit 3/4 = "already exists" — non-fatal
    if (result.code !== 0 && result.code !== 3 && result.code !== 4) {
      throw new Error(`${serverName} Failed to add DMARC record for ${domain}: ${result.stderr}`);
    }
    if (result.code === 3 || result.code === 4) {
      params.log(`[Auto-Fix] add_dmarc/${serverName}: DMARC already exists for ${domain} (exit ${result.code}) — continuing`);
    } else {
      params.log(`[Auto-Fix] add_dmarc/${serverName}: Added DMARC record for ${domain}`);
    }
  }
}

/**
 * Fix DMARC record: delete all _dmarc TXT records, add correct one
 */
async function fixDMARC(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { log: (msg: string) => void }
): Promise<void> {
  // Hard Lesson #95: No rua= in DMARC — external reporting domain
  // (thestealthmail.com) lacks authorization records for sending domains,
  // causing MXToolbox "External Domains not giving permission" warning.
  const dmarcValue = '"v=DMARC1; p=quarantine; pct=100"';
  const addCmd = `v-add-dns-record admin ${domain} _dmarc TXT ${dmarcValue}`;

  const matchFn = (line: string) => {
    const parts = line.split(/\s+/);
    return parts[2] === 'TXT' && parts[1] === '_dmarc';
  };

  await robustDNSRecordReplace([ssh1, ssh2], domain, matchFn, [addCmd], params.log, 'fix_dmarc');
}

/**
 * Fix PTR record via VPS provider
 */
async function fixPTR(
  vpsProvider: VPSProvider,
  domain: string,
  serverIP: string,
  server1IP: string,
  server2IP: string,
  nsDomain: string,
  params: { server1Domains: string[]; server2Domains: string[]; log: (msg: string) => void }
): Promise<void> {
  const correctIP = params.server2Domains.includes(domain) ? server2IP : server1IP;
  const isS2 = params.server2Domains.includes(domain);
  const serverNum = isS2 ? '2' : '1';
  const ptrHostname = `mail${serverNum}.${nsDomain}`;

  await vpsProvider.setPTR({ ip: correctIP, hostname: ptrHostname });
  params.log(`[Auto-Fix] fix_ptr: Set PTR for ${correctIP} to ${ptrHostname}`);
}

/**
 * Reissue SSL certificate.
 *
 * S1 domains: Issue LE cert directly on S1 (A record points to S1, ACME validates there).
 * S2 domains: Issue LE cert on S1 (web domain exists there from security_hardening),
 *   then replicate to S2 — because S2 sending domains have dual A records (S1+S2),
 *   making direct ACME validation on either server non-deterministic.
 *   The replication flow matches replicateSSLCertToSecondary in hestia-scripts.ts.
 *
 * Key HestiaCP behaviors discovered during testing:
 * - v-add-web-domain returns exit 4 ("folder should not exist") when an orphan
 *   .well-known folder remains from a prior LE attempt, even though no web domain
 *   config exists. Fix: detect via v-list-web-domain, remove folder, retry.
 * - v-add-letsencrypt-domain with '' 'yes' (mail flag) fails exit 3 on S1 for S2
 *   domains because S2 sending domains have no mail domain on S1. Omit mail flag.
 * - Copying cert files to disk is not enough — must call v-add-web-domain-ssl to
 *   register SSL with HestiaCP, then v-rebuild-web-domain for nginx to load it.
 */
async function reissueSSL(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { server1Domains: string[]; server2Domains: string[]; server1IP: string; server2IP: string; log: (msg: string) => void }
): Promise<void> {
  const isS2 = params.server2Domains.includes(domain);
  const targetIP = isS2 ? params.server2IP : params.server1IP;

  if (!isS2) {
    // ---- S1 domain: LE issuance on S1 with retry loop ----
    await ensureWebDomain(ssh1, domain, 'S1', params.log);

    // Pre-flight: fail fast if LE rate-limited this domain recently
    const rateLimit = await checkLERateLimit(ssh1, domain);
    if (rateLimit.rateLimited) {
      throw new Error(`LE_RATE_LIMIT: ${rateLimit.message}`);
    }

    const maxRetries = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await ssh1.exec(
          `${HESTIA_PATH_PREFIX}v-add-letsencrypt-domain admin ${domain} '' yes`,
          { timeout: 120000 }
        );
        params.log(`[Auto-Fix] reissue_ssl/S1: LE cert issued for ${domain} (attempt ${attempt})`);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          params.log(`[Auto-Fix] reissue_ssl/S1: LE attempt ${attempt}/${maxRetries} failed for ${domain}, retrying in 30s...`);
          await new Promise(r => setTimeout(r, 30000));
        }
      }
    }
    if (lastErr) {
      throw new Error(
        `reissue_ssl/S1: LE cert failed for ${domain} after ${maxRetries} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
      );
    }

    await ssh1.exec(
      `${HESTIA_PATH_PREFIX}v-rebuild-web-domain admin ${domain}`,
      { timeout: 60000 }
    );

    try {
      await ssh1.exec(
        `${HESTIA_PATH_PREFIX}v-rebuild-mail-domain admin ${domain}`,
        { timeout: 60000 }
      );
    } catch {
      // mail domain may not exist
    }

    params.log(`[Auto-Fix] reissue_ssl/S1: Reissued SSL certificate for ${domain}`);
    return;
  }

  // ---- S2 domain: issue cert on S2 ----
  // S2 sending domains often have dual A records (S1+S2 IPs). LE's multi-vantage
  // validation checks from multiple locations and ALL must see the challenge file.
  // With dual A records, LE validates against both IPs — the challenge file only
  // exists on the server running v-add-letsencrypt-domain, so the other IP 404s.
  //
  // Strategy: (1) Remove stale S1 A records from both zones, (2) try LE on S2,
  // (3) if LE fails (DNS caching of old A records), fall back to self-signed cert.
  // The VG check only validates that the cert CN matches the domain, not CA chain,
  // so self-signed certs pass. For cold email servers, port 443 certs don't affect
  // deliverability — ports 25/587/993 certs are what matter and those are handled
  // by the mail domain setup.
  params.log(`[Auto-Fix] reissue_ssl/S2: ${domain} — preparing cert on S2`);

  // Step 1: Ensure web domain exists on S2
  await ensureWebDomain(ssh2, domain, 'S2', params.log);

  // Step 2: Remove stale S1 A records from DNS zones on BOTH servers.
  const s1IP = params.server1IP;
  for (const [ssh, sName] of [[ssh1, 'S1'], [ssh2, 'S2']] as const) {
    try {
      const { stdout: records } = await ssh.exec(
        `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
        { timeout: 15000 }
      );
      for (const line of records.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4 && parts[1] === '@' && parts[2] === 'A' && parts[3] === s1IP) {
          const recordId = parts[0];
          params.log(`[Auto-Fix] reissue_ssl/S2: Removing stale S1 A record (id=${recordId}) from ${sName} zone for ${domain}`);
          try {
            await ssh.exec(
              `${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${recordId}`,
              { timeout: 15000 }
            );
          } catch {
            // Non-fatal
          }
        }
      }
    } catch {
      params.log(`[Auto-Fix] reissue_ssl/S2: Warning: could not clean DNS on ${sName} for ${domain}`);
    }
  }

  // Step 3: Try LE on S2 — NO self-signed fallback (self-signed certs cause MXToolbox
  // cert chain errors). With the A-record fix (primaryIP), S2 domains now correctly
  // resolve to S2's IP, so LE HTTP-01 validation should succeed.
  const certDir = `/home/admin/conf/web/${domain}/ssl`;

  // Pre-flight: fail fast if LE rate-limited this domain recently
  const rateLimitS2 = await checkLERateLimit(ssh2, domain);
  if (rateLimitS2.rateLimited) {
    throw new Error(`LE_RATE_LIMIT: ${rateLimitS2.message}`);
  }

  const maxRetries = 3;
  let lastLeErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt === 1) {
        // Brief delay on first attempt
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      await ssh2.exec(
        `${HESTIA_PATH_PREFIX}v-add-letsencrypt-domain admin ${domain} '' yes`,
        { timeout: 120000 }
      );
      // Verify cert was actually created (LE can exit 0 without creating files)
      await ssh2.exec(`test -f ${certDir}/${domain}.crt && test -f ${certDir}/${domain}.key`, { timeout: 10000 });
      params.log(`[Auto-Fix] reissue_ssl/S2: LE cert issued for ${domain} (attempt ${attempt})`);
      lastLeErr = null;
      break;
    } catch (err) {
      lastLeErr = err;
      if (attempt < maxRetries) {
        params.log(`[Auto-Fix] reissue_ssl/S2: LE attempt ${attempt}/${maxRetries} failed for ${domain}, retrying in 30s...`);
        await new Promise(r => setTimeout(r, 30000));
      }
    }
  }
  if (lastLeErr) {
    // DO NOT fall back to self-signed — it causes MXToolbox cert chain errors.
    throw new Error(
      `reissue_ssl/S2: LE cert failed for ${domain} after ${maxRetries} attempts (no self-signed fallback): ${lastLeErr instanceof Error ? lastLeErr.message : String(lastLeErr)}`
    );
  }

  // Step 4: Register SSL with HestiaCP on S2
  try {
    await ssh2.exec(
      `${HESTIA_PATH_PREFIX}v-add-web-domain-ssl admin ${domain} ${certDir}`,
      { timeout: 60000 }
    );
  } catch (err: unknown) {
    const exitCode = (err as { code?: number })?.code;
    if (exitCode !== 4) {
      throw new Error(
        `reissue_ssl/S2: v-add-web-domain-ssl failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Step 5: Rebuild web + mail domain on S2
  await ssh2.exec(
    `${HESTIA_PATH_PREFIX}v-rebuild-web-domain admin ${domain}`,
    { timeout: 60000 }
  );

  try {
    await ssh2.exec(
      `${HESTIA_PATH_PREFIX}v-rebuild-mail-domain admin ${domain}`,
      { timeout: 60000 }
    );
  } catch {
    // mail domain rebuild non-fatal
  }

  // Step 6: Verify the cert is actually served via port 443
  const { stdout: certSubject } = await ssh2.exec(
    `echo | openssl s_client -connect ${targetIP}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -subject 2>/dev/null || echo "CN=UNVERIFIED"`,
    { timeout: 15000 }
  );
  if (!certSubject || !certSubject.includes(domain)) {
    throw new Error(
      `reissue_ssl/S2: cert installed but SNI check shows wrong cert for ${domain}: ${certSubject.trim()}`
    );
  }

  params.log(`[Auto-Fix] reissue_ssl/S2: Installed LE SSL certificate for ${domain} on S2`);
}

/**
 * Ensure a web domain exists in HestiaCP on the given server.
 * Handles the orphan-folder case: v-add-web-domain returns exit 4 when a
 * leftover .well-known folder exists from a prior LE attempt, even though
 * no web domain config exists. We detect this by checking v-list-web-domain,
 * remove the orphan folder, and retry.
 */
async function ensureWebDomain(
  ssh: SSHManager,
  domain: string,
  serverName: string,
  log: (msg: string) => void
): Promise<void> {
  try {
    await ssh.exec(
      `${HESTIA_PATH_PREFIX}v-add-web-domain admin ${domain}`,
      { timeout: 60000 }
    );
    return; // Success — web domain created
  } catch (err: unknown) {
    const exitCode = (err as { code?: number })?.code;
    if (exitCode !== 4) {
      throw new Error(`${serverName} Failed to add web domain ${domain}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Exit 4: either web domain genuinely exists, or orphan folder blocks creation.
  }

  // Check if the web domain actually exists in HestiaCP config
  try {
    await ssh.exec(
      `${HESTIA_PATH_PREFIX}v-list-web-domain admin ${domain}`,
      { timeout: 15000 }
    );
    // Web domain exists — nothing more to do
    return;
  } catch {
    // Web domain does NOT exist — orphan folder is blocking v-add-web-domain
  }

  // Remove the orphan web folder and retry
  log(`[Auto-Fix] ${serverName}: Removing orphan web folder for ${domain} (blocks v-add-web-domain)`);
  await ssh.exec(
    `rm -rf /home/admin/web/${domain}`,
    { timeout: 15000 }
  );

  await ssh.exec(
    `${HESTIA_PATH_PREFIX}v-add-web-domain admin ${domain}`,
    { timeout: 60000 }
  );
}

/**
 * Add MTA-STS record and file
 */
async function addMTASTS(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { server1Domains: string[]; server2Domains: string[]; log: (msg: string) => void }
): Promise<void> {
  // Generate timestamp
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);

  const mtaStsValue = `"v=STSv1; id=${timestamp}"`;
  const addCmd = `v-add-dns-record admin ${domain} _mta-sts TXT ${mtaStsValue}`;

  // Add DNS record on both servers — tolerate "already exists" (exit 3/4)
  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    // Check if MTA-STS record already exists
    const listResult = await ssh.exec(
      `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
      { timeout: 10000 }
    );
    if (listResult.code === 0) {
      const existingMtaSts = listResult.stdout.split('\n').find(
        l => l.includes('_mta-sts') && l.includes('TXT') && l.includes('v=STSv1')
      );
      if (existingMtaSts) {
        params.log(`[Auto-Fix] add_mta_sts/${serverName}: MTA-STS DNS record already exists for ${domain} — skipping`);
        continue;
      }
    }

    const dnsResult = await ssh.exec(`${HESTIA_PATH_PREFIX}${addCmd}`, { timeout: 10000 });
    if (dnsResult.code !== 0 && dnsResult.code !== 3 && dnsResult.code !== 4) {
      throw new Error(`${serverName} Failed to add MTA-STS DNS record for ${domain}: ${dnsResult.stderr}`);
    }
    if (dnsResult.code === 3 || dnsResult.code === 4) {
      params.log(`[Auto-Fix] add_mta_sts/${serverName}: MTA-STS already exists for ${domain} (exit ${dnsResult.code}) — continuing`);
    }
  }

  // Create .well-known/mta-sts.txt on web server
  const isS2 = params.server2Domains.includes(domain);
  const serverNum = isS2 ? '2' : '1';
  const targetSSH = isS2 ? ssh2 : ssh1;
  const serverName = isS2 ? 'S2' : 'S1';

  const mxHost = `mail${serverNum}.${domain}`;
  const mtaStsContent = `version: STSv1
mode: enforce
mx: ${mxHost}
max_age: 604800`;

  const mkdirCmd = `mkdir -p /home/admin/web/${domain}/public_html/.well-known`;
  const mkdirResult = await targetSSH.exec(mkdirCmd, { timeout: 10000 });
  if (mkdirResult.code !== 0) {
    throw new Error(`${serverName} Failed to create .well-known directory for ${domain}: ${mkdirResult.stderr}`);
  }

  const writeCmd = `cat > /home/admin/web/${domain}/public_html/.well-known/mta-sts.txt << 'EOF'\n${mtaStsContent}\nEOF`;
  const writeResult = await targetSSH.exec(writeCmd, { timeout: 10000 });
  if (writeResult.code !== 0) {
    throw new Error(`${serverName} Failed to write MTA-STS file for ${domain}: ${writeResult.stderr}`);
  }

  params.log(`[Auto-Fix] add_mta_sts/${serverName}: Added MTA-STS record and file for ${domain}`);
}

/**
 * Add TLSRPT record
 */
async function addTLSRPT(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { log: (msg: string) => void }
): Promise<void> {
  // Hard Lesson #95: No external rua — thestealthmail.com lacks authorization records
  // TLS-RPT is optional and VG check is skipped, but keep the value clean just in case
  const tlsrptValue = '"v=TLSRPTv1;"';
  const addCmd = `v-add-dns-record admin ${domain} _smtp._tls TXT ${tlsrptValue}`;

  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    // Check if TLSRPT already exists
    const listResult = await ssh.exec(
      `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
      { timeout: 10000 }
    );
    if (listResult.code === 0) {
      const existingTlsrpt = listResult.stdout.split('\n').find(
        l => l.includes('_smtp._tls') && l.includes('TXT') && l.includes('TLSRPTv1')
      );
      if (existingTlsrpt) {
        params.log(`[Auto-Fix] add_tlsrpt/${serverName}: TLSRPT record already exists for ${domain} — skipping`);
        continue;
      }
    }

    const result = await ssh.exec(`${HESTIA_PATH_PREFIX}${addCmd}`, { timeout: 10000 });
    // Hard Lesson #97: exit 3/4 = "already exists" — non-fatal
    if (result.code !== 0 && result.code !== 3 && result.code !== 4) {
      throw new Error(`${serverName} Failed to add TLSRPT record for ${domain}: ${result.stderr}`);
    }
    if (result.code === 3 || result.code === 4) {
      params.log(`[Auto-Fix] add_tlsrpt/${serverName}: TLSRPT already exists for ${domain} (exit ${result.code}) — continuing`);
    } else {
      params.log(`[Auto-Fix] add_tlsrpt/${serverName}: Added TLSRPT record for ${domain}`);
    }
  }
}

/**
 * Add BIMI record
 */
async function addBIMI(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { log: (msg: string) => void }
): Promise<void> {
  const bimiValue = '\'"v=BIMI1; l=; a="\'';
  const addCmd = `v-add-dns-record admin ${domain} default._bimi TXT ${bimiValue}`;

  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    // Check if BIMI already exists
    const listResult = await ssh.exec(
      `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
      { timeout: 10000 }
    );
    if (listResult.code === 0) {
      const existingBIMI = listResult.stdout.split('\n').find(
        l => l.includes('default._bimi') && l.includes('TXT') && l.includes('v=BIMI1')
      );
      if (existingBIMI) {
        params.log(`[Auto-Fix] add_bimi/${serverName}: BIMI record already exists for ${domain} — skipping`);
        continue;
      }
    }

    const result = await ssh.exec(`${HESTIA_PATH_PREFIX}${addCmd}`, { timeout: 10000 });
    // Hard Lesson #97: exit 3/4 = "already exists" — non-fatal
    if (result.code !== 0 && result.code !== 3 && result.code !== 4) {
      throw new Error(`${serverName} Failed to add BIMI record for ${domain}: ${result.stderr}`);
    }
    if (result.code === 3 || result.code === 4) {
      params.log(`[Auto-Fix] add_bimi/${serverName}: BIMI already exists for ${domain} (exit ${result.code}) — continuing`);
    } else {
      params.log(`[Auto-Fix] add_bimi/${serverName}: Added BIMI record for ${domain}`);
    }
  }
}

/**
 * Fix SOA serial sync between S1 and S2
 * Rebuilds zones on both servers, reloads BIND, verifies S2 responds
 */
async function fixSOASerialSync(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: {
    server1IP: string;
    server2IP: string;
    nsDomain: string;
    server1Domains: string[];
    server2Domains: string[];
    log: (msg: string) => void;
  }
): Promise<void> {
  // Step 1: Rebuild zone on S1 (the primary/source of truth)
  const rebuildS1 = await ssh1.exec(
    `${HESTIA_PATH_PREFIX}v-rebuild-dns-domain admin ${domain}`,
    { timeout: 15000 }
  );
  if (rebuildS1.code !== 0) {
    throw new Error(`S1 Failed to rebuild zone for ${domain}: ${rebuildS1.stderr}`);
  }
  params.log(`[Auto-Fix] fix_soa_serial_sync/S1: Rebuilt zone for ${domain}`);

  // Step 2: Rebuild zone on S2
  const rebuildS2 = await ssh2.exec(
    `${HESTIA_PATH_PREFIX}v-rebuild-dns-domain admin ${domain}`,
    { timeout: 15000 }
  );
  if (rebuildS2.code !== 0) {
    // If domain doesn't exist on S2, add it first
    if (rebuildS2.stderr?.includes('doesn\'t exist') || rebuildS2.stderr?.includes('not exist')) {
      const serverIP = params.server2Domains.includes(domain) ? params.server2IP : params.server1IP;
      const addResult = await ssh2.exec(
        `${HESTIA_PATH_PREFIX}v-add-dns-domain admin ${domain} ${serverIP}`,
        { timeout: 15000 }
      );
      if (addResult.code !== 0 && addResult.code !== 3 && addResult.code !== 4) {
        throw new Error(`S2 Failed to add zone for ${domain}: ${addResult.stderr}`);
      }
      params.log(`[Auto-Fix] fix_soa_serial_sync/S2: Added missing zone for ${domain}`);
    } else {
      throw new Error(`S2 Failed to rebuild zone for ${domain}: ${rebuildS2.stderr}`);
    }
  }
  params.log(`[Auto-Fix] fix_soa_serial_sync/S2: Rebuilt zone for ${domain}`);

  // Step 3: Reload BIND on both servers
  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    const result = await ssh.exec('rndc reload', { timeout: 10000 });
    if (result.code !== 0) {
      params.log(`[Auto-Fix] fix_soa_serial_sync/${serverName}: rndc reload warning: ${result.stderr}`);
    }
  }

  // Step 4: Verify S2 responds to queries for this zone
  const verifyResult = await ssh1.exec(
    `dig SOA ${domain} @${params.server2IP} +short +time=5 +tries=1 2>/dev/null`,
    { timeout: 10000 }
  );
  const s2SOA = verifyResult.stdout.trim();
  if (!s2SOA) {
    throw new Error(`S2 still not responding for ${domain} after rebuild + reload`);
  }

  params.log(`[Auto-Fix] fix_soa_serial_sync: Verified — S2 responding for ${domain} (SOA: ${s2SOA})`);
}

/**
 * Main entry point: run all auto-fixes
 */
export async function runAutoFixes(
  ssh1: SSHManager,
  ssh2: SSHManager,
  vpsProvider: VPSProvider,
  issues: VerificationResult[],
  params: {
    nsDomain: string;
    server1IP: string;
    server2IP: string;
    server1Domains: string[];
    server2Domains: string[];
    log: (msg: string) => void;
  }
): Promise<{ fixed: string[]; failed: string[] }> {
  const fixed: string[] = [];
  const failed: string[] = [];

  // Filter to only auto_fixable issues
  const fixableIssues = issues.filter(i => i.status === 'auto_fixable' && i.fixAction);

  if (fixableIssues.length === 0) {
    params.log('[Auto-Fix] No auto-fixable issues found. Skipping.');
    return { fixed, failed };
  }

  params.log(`[Auto-Fix] Attempting to fix ${fixableIssues.length} auto-fixable issues...`);

  // Deduplicate by fixAction + domain
  const seen = new Set<string>();
  const dedupedIssues = fixableIssues.filter(issue => {
    const key = `${issue.fixAction}:${issue.domain}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Two-phase execution: DNS fixes first, then SSL (which needs public DNS propagation)
  const SSL_ACTIONS = new Set(['reissue_ssl']);
  const dnsIssues = dedupedIssues.filter(i => !SSL_ACTIONS.has(i.fixAction!));
  const sslIssues = dedupedIssues.filter(i => SSL_ACTIONS.has(i.fixAction!));

  params.log(`[Auto-Fix] Phase 1: ${dnsIssues.length} DNS fixes. Phase 2: ${sslIssues.length} SSL certs.`);

  // === PHASE 1: DNS record fixes ===
  for (const issue of dnsIssues) {
    const key = `${issue.fixAction}:${issue.domain}`;
    try {
      switch (issue.fixAction) {
        case 'fix_a_record':
          await fixARecord(ssh1, ssh2, issue.domain, params.server1IP, params.server1IP, params.server2IP, params);
          break;

        case 'add_webmail_a': {
          // issue.domain may be "webmail.nelita.info" or "mail.nelita.info" —
          // strip the subdomain prefix to get the zone name for HestiaCP commands
          const baseDomain = issue.domain.replace(/^(webmail|mail)\./, '');
          await addWebmailA(ssh1, ssh2, baseDomain, params.server1IP, params.server2IP, params);
          break;
        }

        case 'fix_mx':
          await fixMX(ssh1, ssh2, issue.domain, params);
          break;

        case 'fix_soa':
          await fixSOA(ssh1, ssh2, issue.domain, params);
          break;

        case 'fix_soa_serial_sync':
          await fixSOASerialSync(ssh1, ssh2, issue.domain, params);
          break;

        case 'fix_zone_transfer':
          await fixZoneTransfer(ssh1, ssh2, issue.domain, params);
          break;

        case 'add_caa':
          await addCAA(ssh1, ssh2, issue.domain, params);
          break;

        case 'add_spf':
          await addSPF(ssh1, ssh2, issue.domain, params.server1IP, params.server2IP, params);
          break;

        case 'fix_spf':
          await fixSPF(ssh1, ssh2, issue.domain, params.server1IP, params.server2IP, params);
          break;

        case 'add_dkim':
          await addDKIM(ssh1, ssh2, issue.domain, params);
          break;

        case 'add_dmarc':
          await addDMARC(ssh1, ssh2, issue.domain, params);
          break;

        case 'fix_dmarc':
          await fixDMARC(ssh1, ssh2, issue.domain, params);
          break;

        case 'fix_ptr':
          await fixPTR(vpsProvider, issue.domain, params.server1IP, params.server1IP, params.server2IP, params.nsDomain, params);
          break;

        case 'reissue_ssl':
          await reissueSSL(ssh1, ssh2, issue.domain, params);
          break;

        case 'add_mta_sts':
          await addMTASTS(ssh1, ssh2, issue.domain, params);
          break;

        case 'add_tlsrpt':
          await addTLSRPT(ssh1, ssh2, issue.domain, params);
          break;

        case 'add_bimi':
          await addBIMI(ssh1, ssh2, issue.domain, params);
          break;

        default:
          throw new Error(`Unknown fix action: ${issue.fixAction}`);
      }

      fixed.push(key);
      params.log(`[Auto-Fix] ✓ Fixed ${key}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push(`${key}: ${msg}`);
      params.log(`[Auto-Fix] ✗ Failed ${key}: ${msg}`);
    }
  }

  // rndc reload after Phase 1 DNS fixes
  params.log('[Auto-Fix] Phase 1 complete. Running rndc reload on both servers...');
  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    const result = await ssh.exec('rndc reload', { timeout: 10000 });
    if (result.code !== 0) {
      params.log(`[Auto-Fix] ✗ rndc reload failed on ${serverName}: ${result.stderr}`);
    } else {
      params.log(`[Auto-Fix] ✓ rndc reload completed on ${serverName}`);
    }
  }

  // === DNS PROPAGATION WAIT between Phase 1 and Phase 2 ===
  if (sslIssues.length > 0) {
    const allSendingDomains = [...params.server1Domains, ...params.server2Domains];
    const getExpectedIP = (domain: string): string =>
      params.server2Domains.includes(domain) ? params.server2IP : params.server1IP;

    await waitForPublicDNSPropagation(ssh1, allSendingDomains, getExpectedIP, params.log);
  }

  // === PHASE 2: SSL cert issuance (public DNS now propagated) ===
  // Pacing: LE's per-account rate limit and internal queuing penalize rapid
  // back-to-back requests from the same IP. 10s between domains spreads load
  // without materially extending total runtime (validation itself is 30-60s).
  const SSL_PACING_MS = 10_000;
  for (let i = 0; i < sslIssues.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, SSL_PACING_MS));
    const issue = sslIssues[i];
    const key = `${issue.fixAction}:${issue.domain}`;
    try {
      await reissueSSL(ssh1, ssh2, issue.domain, params);
      fixed.push(key);
      params.log(`[Auto-Fix] ✓ Fixed ${key} (${i + 1}/${sslIssues.length})`);
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      // Enrich with LE "detail" message from the ACME log if available
      try {
        const targetSsh = params.server2Domains.includes(issue.domain) ? ssh2 : ssh1;
        const { stdout } = await targetSsh.exec(
          `tail -40 /var/log/hestia/LE-admin-${issue.domain}.log 2>/dev/null | grep -oE '"detail": *"[^"]+"' | tail -1 || echo ""`,
          { timeout: 5000 }
        );
        const match = stdout.match(/"detail": *"([^"]+)"/);
        if (match) msg += ` | LE: ${match[1]}`;
      } catch {
        // Non-fatal
      }
      failed.push(`${key}: ${msg}`);
      params.log(`[Auto-Fix] ✗ Failed ${key}: ${msg}`);
    }
  }

  params.log(
    `[Auto-Fix] Complete. Fixed: ${fixed.length}, Failed: ${failed.length}`
  );

  return { fixed, failed };
}
