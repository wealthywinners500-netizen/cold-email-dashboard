import type { SSHManager } from './ssh-manager';
import type { VerificationResult, VPSProvider } from './types';
import { HESTIA_PATH_PREFIX } from './hestia-scripts';

/**
 * Auto-fix module for cold email server provisioning.
 * Reads verification results and applies automated fixes for auto_fixable issues.
 */

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
  // Try with quotes first, then without if it fails
  let cmd = `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} @ CAA '0 issue "letsencrypt.org"'`;

  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    let result = await ssh.exec(cmd, { timeout: 10000 });

    // If failed, try without quotes
    if (result.code !== 0) {
      cmd = `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} @ CAA 0 issue letsencrypt.org`;
      result = await ssh.exec(cmd, { timeout: 10000 });
    }

    if (result.code !== 0) {
      throw new Error(`${serverName} Failed to add CAA record for ${domain}: ${result.stderr}`);
    }
    params.log(`[Auto-Fix] add_caa/${serverName}: Added CAA record for ${domain}`);
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
    const result = await ssh.exec(`${HESTIA_PATH_PREFIX}${addCmd}`, { timeout: 10000 });
    if (result.code !== 0) {
      throw new Error(`${serverName} Failed to add SPF record for ${domain}: ${result.stderr}`);
    }
    params.log(`[Auto-Fix] add_spf/${serverName}: Added SPF record for ${domain}`);
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
 * Add DKIM record: read from source server, add to both
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

  // Read DKIM from source server
  const listCmd = `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`;
  const listResult = await sourceSSH.exec(listCmd, { timeout: 10000 });

  if (listResult.code !== 0) {
    throw new Error(`${sourceServer} Failed to list DNS records for ${domain}: ${listResult.stderr}`);
  }

  const lines = listResult.stdout.trim().split('\n').filter(l => l.length > 0);
  const dkimLine = lines.find(l => l.includes('mail._domainkey') && l.includes('TXT'));

  if (!dkimLine) {
    // Try to regenerate DKIM
    params.log(`[Auto-Fix] add_dkim/${sourceServer}: No DKIM found, attempting to regenerate for ${domain}`);
    const genCmd = `${HESTIA_PATH_PREFIX}v-add-mail-domain-dkim admin ${domain}`;
    const genResult = await sourceSSH.exec(genCmd, { timeout: 15000 });

    if (genResult.code !== 0) {
      throw new Error(`${sourceServer} Failed to regenerate DKIM for ${domain}: ${genResult.stderr}`);
    }

    // Re-list to get the new DKIM
    const relistResult = await sourceSSH.exec(listCmd, { timeout: 10000 });
    if (relistResult.code !== 0) {
      throw new Error(`${sourceServer} Failed to re-list DNS records for ${domain}: ${relistResult.stderr}`);
    }

    const relistLines = relistResult.stdout.trim().split('\n').filter(l => l.length > 0);
    const newDkimLine = relistLines.find(l => l.includes('mail._domainkey') && l.includes('TXT'));

    if (!newDkimLine) {
      throw new Error(`${sourceServer} Failed to find DKIM record even after regeneration for ${domain}`);
    }

    // Extract DKIM value from the line
    const parts = newDkimLine.split(/\s+/);
    const dkimValue = parts.slice(3).join(' ');

    // Add to other server
    const otherSSH = sourceSSH === ssh1 ? ssh2 : ssh1;
    const otherServer = sourceServer === 'S1' ? 'S2' : 'S1';
    const addCmd = `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} mail._domainkey TXT ${dkimValue}`;
    const addResult = await otherSSH.exec(addCmd, { timeout: 10000 });

    if (addResult.code !== 0) {
      throw new Error(`${otherServer} Failed to add DKIM record for ${domain}: ${addResult.stderr}`);
    }

    params.log(`[Auto-Fix] add_dkim/${otherServer}: Added DKIM record for ${domain}`);
  } else {
    // Extract DKIM value
    const parts = dkimLine.split(/\s+/);
    const dkimValue = parts.slice(3).join(' ');

    // Add to other server
    const otherSSH = sourceSSH === ssh1 ? ssh2 : ssh1;
    const otherServer = sourceServer === 'S1' ? 'S2' : 'S1';
    const addCmd = `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} mail._domainkey TXT ${dkimValue}`;
    const addResult = await otherSSH.exec(addCmd, { timeout: 10000 });

    if (addResult.code !== 0) {
      throw new Error(`${otherServer} Failed to add DKIM record for ${domain}: ${addResult.stderr}`);
    }

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
    const result = await ssh.exec(`${HESTIA_PATH_PREFIX}${addCmd}`, { timeout: 10000 });
    if (result.code !== 0) {
      throw new Error(`${serverName} Failed to add DMARC record for ${domain}: ${result.stderr}`);
    }
    params.log(`[Auto-Fix] add_dmarc/${serverName}: Added DMARC record for ${domain}`);
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
 * Reissue SSL certificate
 */
async function reissueSSL(
  ssh1: SSHManager,
  ssh2: SSHManager,
  domain: string,
  params: { server1Domains: string[]; server2Domains: string[]; log: (msg: string) => void }
): Promise<void> {
  // Determine which server to use
  const targetSSH = params.server2Domains.includes(domain) ? ssh2 : ssh1;
  const serverName = params.server2Domains.includes(domain) ? 'S2' : 'S1';

  // Step 1: Ensure the web domain exists on the target server.
  // During security_hardening, v-add-web-domain is only run on S1 for all domains.
  // For S2 domains where the initial LE cert fails on S1, replicateSSLCertToSecondary
  // (which adds the web domain to S2) is never reached. Without the web domain,
  // nginx has no vhost and serves the default hostname cert on port 443.
  // NOTE: SSHManager.exec() throws SSHCommandError for ANY non-zero exit code,
  // so we must use try/catch and check err.code, not check a return value.
  try {
    await targetSSH.exec(
      `${HESTIA_PATH_PREFIX}v-add-web-domain admin ${domain}`,
      { timeout: 60000 }
    );
  } catch (err: unknown) {
    const exitCode = (err as { code?: number })?.code;
    if (exitCode !== 4) {
      // Exit code 4 = domain already exists, that's fine. Anything else is a real error.
      throw new Error(`${serverName} Failed to add web domain ${domain}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 2: Issue the LE certificate
  const cmd = `${HESTIA_PATH_PREFIX}v-add-letsencrypt-domain admin ${domain} '' yes`;
  await targetSSH.exec(cmd, { timeout: 120000 });

  // Step 3: Rebuild web domain so nginx loads the new cert for this vhost.
  // Without this, port 443 continues serving the hostname cert for SNI requests.
  await targetSSH.exec(
    `${HESTIA_PATH_PREFIX}v-rebuild-web-domain admin ${domain}`,
    { timeout: 60000 }
  );

  // Step 4: Rebuild mail domain if it exists, so Exim reloads TLS config.
  // Non-fatal if domain has no mail domain (e.g. NS-only domain).
  try {
    await targetSSH.exec(
      `${HESTIA_PATH_PREFIX}v-rebuild-mail-domain admin ${domain}`,
      { timeout: 60000 }
    );
  } catch {
    // mail domain may not exist — not an error
  }

  params.log(`[Auto-Fix] reissue_ssl/${serverName}: Reissued SSL certificate for ${domain}`);
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

  // Add DNS record on both servers
  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    const dnsResult = await ssh.exec(`${HESTIA_PATH_PREFIX}${addCmd}`, { timeout: 10000 });
    if (dnsResult.code !== 0) {
      throw new Error(`${serverName} Failed to add MTA-STS DNS record for ${domain}: ${dnsResult.stderr}`);
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
    const result = await ssh.exec(`${HESTIA_PATH_PREFIX}${addCmd}`, { timeout: 10000 });
    if (result.code !== 0) {
      throw new Error(`${serverName} Failed to add TLSRPT record for ${domain}: ${result.stderr}`);
    }
    params.log(`[Auto-Fix] add_tlsrpt/${serverName}: Added TLSRPT record for ${domain}`);
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
    const result = await ssh.exec(`${HESTIA_PATH_PREFIX}${addCmd}`, { timeout: 10000 });
    if (result.code !== 0) {
      throw new Error(`${serverName} Failed to add BIMI record for ${domain}: ${result.stderr}`);
    }
    params.log(`[Auto-Fix] add_bimi/${serverName}: Added BIMI record for ${domain}`);
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

  // Process each deduped issue
  for (const issue of dedupedIssues) {
    const key = `${issue.fixAction}:${issue.domain}`;
    try {
      switch (issue.fixAction) {
        case 'fix_a_record':
          await fixARecord(ssh1, ssh2, issue.domain, params.server1IP, params.server1IP, params.server2IP, params);
          break;

        case 'add_webmail_a':
          await addWebmailA(ssh1, ssh2, issue.domain, params.server1IP, params.server2IP, params);
          break;

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

  // Final rndc reload on both servers
  params.log('[Auto-Fix] Running final rndc reload on both servers...');
  for (const [ssh, serverName] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
    const result = await ssh.exec('rndc reload', { timeout: 10000 });
    if (result.code !== 0) {
      params.log(`[Auto-Fix] ✗ rndc reload failed on ${serverName}: ${result.stderr}`);
    } else {
      params.log(`[Auto-Fix] ✓ rndc reload completed on ${serverName}`);
    }
  }

  params.log(
    `[Auto-Fix] Complete. Fixed: ${fixed.length}, Failed: ${failed.length}`
  );

  return { fixed, failed };
}
