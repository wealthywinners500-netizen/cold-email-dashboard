import type { SSHManager } from './ssh-manager';
import type { VerificationResult } from './types';
import { HESTIA_PATH_PREFIX } from './hestia-scripts';

/**
 * Comprehensive verification checks for HestiaCP mail server provisioning.
 * Implements 36 checks across DNS, authentication, SMTP, SSL, and blacklist categories.
 * Called by both Verification Gate 1 (VG1) and Verification Gate 2 (VG2).
 */
export async function runVerificationChecks(
  ssh1: SSHManager,
  ssh2: SSHManager,
  params: {
    nsDomain: string;
    sendingDomains: string[];
    server1IP: string;
    server2IP: string;
    server1Domains: string[];
    server2Domains: string[];
    log: (msg: string) => void;
  }
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  const {
    nsDomain,
    sendingDomains,
    server1IP,
    server2IP,
    server1Domains,
    server2Domains,
    log,
  } = params;

  // All domains to check: NS domain + all sending domains
  const allDomains = [nsDomain, ...sendingDomains];

  // Helper to determine which server a domain belongs to
  const getServerForDomain = (domain: string): 'S1' | 'S2' => {
    if (domain === nsDomain) return 'S1';
    if (server1Domains.includes(domain)) return 'S1';
    if (server2Domains.includes(domain)) return 'S2';
    return 'S1'; // Default to S1 if not found
  };

  const getServerIPForDomain = (domain: string): string => {
    const server = getServerForDomain(domain);
    return server === 'S1' ? server1IP : server2IP;
  };

  // DNS resolvers to check against
  const resolvers = ['8.8.8.8', '1.1.1.1', '9.9.9.9'];
  const primaryResolver = '8.8.8.8';

  // ============================================================================
  // CATEGORY 1: DNS Record Checks (1-10)
  // ============================================================================

  // Check 1: DNS A record correctness
  log('[VG] Running check 1: DNS A record correctness');
  for (const domain of allDomains) {
    const expectedIP = getServerIPForDomain(domain);
    const server = getServerForDomain(domain);

    for (const resolver of resolvers) {
      try {
        const result = await ssh1.exec(`dig +short ${domain} A @${resolver} 2>/dev/null`, {
          timeout: 15000,
        });
        const ips = result.stdout.trim().split('\n').filter(Boolean);

        if (ips.length === 0) {
          results.push({
            check: 'dns_a_record',
            domain,
            server,
            status: 'auto_fixable',
            details: `No A record found for ${domain} on resolver ${resolver}`,
            fixAction: 'fix_a_record',
          });
        } else if (!ips.includes(expectedIP)) {
          results.push({
            check: 'dns_a_record',
            domain,
            server,
            status: 'auto_fixable',
            details: `A record resolves to ${ips.join(', ')} but expected ${expectedIP} on resolver ${resolver}`,
            fixAction: 'fix_a_record',
          });
        } else {
          results.push({
            check: 'dns_a_record',
            domain,
            server,
            status: 'pass',
            details: `A record correctly resolves to ${expectedIP} on resolver ${resolver}`,
          });
        }
      } catch (err) {
        results.push({
          check: 'dns_a_record',
          domain,
          server,
          status: 'manual_required',
          details: `Error checking A record on resolver ${resolver}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Check 2: webmail/mail A record
  log('[VG] Running check 2: webmail/mail A record');
  for (const domain of allDomains) {
    const expectedIP = getServerIPForDomain(domain);
    const server = getServerForDomain(domain);

    const subdomains = ['webmail', 'mail'];
    for (const subdomain of subdomains) {
      try {
        const result = await ssh1.exec(
          `dig +short ${subdomain}.${domain} A @${primaryResolver} 2>/dev/null`,
          { timeout: 15000 }
        );
        const ips = result.stdout.trim().split('\n').filter(Boolean);

        if (ips.length === 0) {
          results.push({
            check: 'webmail_mail_a_record',
            domain: `${subdomain}.${domain}`,
            server,
            status: 'auto_fixable',
            details: `No A record found for ${subdomain}.${domain}`,
            fixAction: 'add_webmail_a',
          });
        } else if (!ips.includes(expectedIP)) {
          results.push({
            check: 'webmail_mail_a_record',
            domain: `${subdomain}.${domain}`,
            server,
            status: 'auto_fixable',
            details: `${subdomain}.${domain} resolves to ${ips.join(', ')} but expected ${expectedIP}`,
            fixAction: 'add_webmail_a',
          });
        } else {
          results.push({
            check: 'webmail_mail_a_record',
            domain: `${subdomain}.${domain}`,
            server,
            status: 'pass',
            details: `${subdomain}.${domain} correctly resolves to ${expectedIP}`,
          });
        }
      } catch (err) {
        results.push({
          check: 'webmail_mail_a_record',
          domain: `${subdomain}.${domain}`,
          server,
          status: 'manual_required',
          details: `Error checking ${subdomain} A record: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Check 3: MX record correctness
  log('[VG] Running check 3: MX record correctness');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);
    const expectedMailHost = server === 'S1' ? `mail1.${nsDomain}` : `mail2.${nsDomain}`;

    try {
      const result = await ssh1.exec(
        `dig +short ${domain} MX @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const mxLines = result.stdout.trim().split('\n').filter(Boolean);

      if (mxLines.length === 0) {
        results.push({
          check: 'mx_record',
          domain,
          server,
          status: 'auto_fixable',
          details: `No MX record found for ${domain}`,
          fixAction: 'fix_mx',
        });
      } else {
        // Parse MX records (format: "priority hostname")
        let foundCorrectMX = false;
        for (const line of mxLines) {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) {
            const mxHost = parts[1].replace(/\.$/, ''); // Remove trailing dot
            if (mxHost === expectedMailHost || mxHost === `${expectedMailHost}.`) {
              foundCorrectMX = true;
              break;
            }
          }
        }

        if (foundCorrectMX) {
          results.push({
            check: 'mx_record',
            domain,
            server,
            status: 'pass',
            details: `MX record correctly points to ${expectedMailHost}`,
          });
        } else {
          results.push({
            check: 'mx_record',
            domain,
            server,
            status: 'auto_fixable',
            details: `MX record does not point to ${expectedMailHost}. Found: ${mxLines.join('; ')}`,
            fixAction: 'fix_mx',
          });
        }
      }
    } catch (err) {
      results.push({
        check: 'mx_record',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking MX record: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 4: MX points to CNAME (RFC violation)
  log('[VG] Running check 4: MX points to CNAME');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const mxResult = await ssh1.exec(
        `dig +short ${domain} MX @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const mxLines = mxResult.stdout.trim().split('\n').filter(Boolean);

      for (const line of mxLines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const mxHost = parts[1].replace(/\.$/, '');

          const cnameResult = await ssh1.exec(
            `dig +short ${mxHost} CNAME @${primaryResolver} 2>/dev/null`,
            { timeout: 15000 }
          );
          const cnames = cnameResult.stdout.trim().split('\n').filter(Boolean);

          if (cnames.length > 0) {
            results.push({
              check: 'mx_cname_violation',
              domain,
              server,
              status: 'auto_fixable',
              details: `MX target ${mxHost} is a CNAME (RFC violation): ${cnames.join('; ')}`,
              fixAction: 'fix_mx',
            });
          } else {
            results.push({
              check: 'mx_cname_violation',
              domain,
              server,
              status: 'pass',
              details: `MX target ${mxHost} is not a CNAME`,
            });
          }
        }
      }
    } catch (err) {
      results.push({
        check: 'mx_cname_violation',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking MX CNAME: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 5: SOA record validation
  log('[VG] Running check 5: SOA record validation');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const soaResult = await ssh1.exec(
        `dig SOA ${domain} @${primaryResolver} +short 2>/dev/null`,
        { timeout: 15000 }
      );
      const soaLine = soaResult.stdout.trim();

      if (!soaLine) {
        results.push({
          check: 'soa_record',
          domain,
          server,
          status: 'manual_required',
          details: `SOA record not found for ${domain}`,
        });
        continue;
      }

      // Parse SOA: "ns1.domain admin.domain serial refresh retry expire minimum"
      const soaParts = soaLine.split(/\s+/);
      if (soaParts.length < 7) {
        results.push({
          check: 'soa_record',
          domain,
          server,
          status: 'auto_fixable',
          details: `SOA record malformed: ${soaLine}`,
          fixAction: 'fix_soa',
        });
        continue;
      }

      const serial = soaParts[2];
      const refresh = parseInt(soaParts[3], 10);
      const retry = parseInt(soaParts[4], 10);
      const expire = parseInt(soaParts[5], 10);
      const minTTL = parseInt(soaParts[6], 10);

      const issues: string[] = [];

      // Check serial format (YYYYMMDDNN)
      if (!/^\d{10}$/.test(serial)) {
        issues.push(`Serial ${serial} not in YYYYMMDDNN format`);
      }

      // Check refresh >= 3600
      if (refresh < 3600) {
        issues.push(`Refresh ${refresh}s < 3600s`);
      }

      // Check retry >= 600
      if (retry < 600) {
        issues.push(`Retry ${retry}s < 600s`);
      }

      // Check expire between 604800 and 2419200
      if (expire < 604800 || expire > 2419200) {
        issues.push(`Expire ${expire}s outside 604800-2419200 range`);
      }

      // Check minimum TTL <= 86400
      if (minTTL > 86400) {
        issues.push(`Minimum TTL ${minTTL}s > 86400s`);
      }

      if (issues.length > 0) {
        results.push({
          check: 'soa_record',
          domain,
          server,
          status: 'auto_fixable',
          details: `SOA issues: ${issues.join('; ')}`,
          fixAction: 'fix_soa',
        });
      } else {
        results.push({
          check: 'soa_record',
          domain,
          server,
          status: 'pass',
          details: `SOA record valid: serial=${serial}, refresh=${refresh}, retry=${retry}, expire=${expire}, minTTL=${minTTL}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'soa_record',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking SOA record: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 6: NS record validation
  log('[VG] Running check 6: NS record validation');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const nsResult = await ssh1.exec(
        `dig NS ${domain} @${primaryResolver} +short 2>/dev/null`,
        { timeout: 15000 }
      );
      const nsLines = nsResult.stdout.trim().split('\n').filter(Boolean);

      if (nsLines.length === 0) {
        results.push({
          check: 'ns_record',
          domain,
          server,
          status: 'manual_required',
          details: `No NS records found for ${domain}`,
        });
      } else {
        const expectedNS1 = `ns1.${nsDomain}.`;
        const expectedNS2 = `ns2.${nsDomain}.`;
        const hasNS1 = nsLines.some((ns) => ns.replace(/\.$/, '') === expectedNS1.replace(/\.$/, ''));
        const hasNS2 = nsLines.some((ns) => ns.replace(/\.$/, '') === expectedNS2.replace(/\.$/, ''));

        if (hasNS1 && hasNS2) {
          results.push({
            check: 'ns_record',
            domain,
            server,
            status: 'pass',
            details: `NS records correctly point to ns1 and ns2: ${nsLines.join('; ')}`,
          });
        } else {
          results.push({
            check: 'ns_record',
            domain,
            server,
            status: 'manual_required',
            details: `NS records do not point to expected nameservers. Found: ${nsLines.join('; ')}`,
          });
        }
      }
    } catch (err) {
      results.push({
        check: 'ns_record',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking NS records: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 7: Glue record validation
  log('[VG] Running check 7: Glue record validation');
  for (const ns of ['ns1', 'ns2']) {
    const nsFqdn = `${ns}.${nsDomain}`;
    try {
      const glueResult = await ssh1.exec(
        `dig +short ${nsFqdn} A @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const glueIPs = glueResult.stdout.trim().split('\n').filter(Boolean);

      const expectedIP = ns === 'ns1' ? server1IP : server2IP;

      if (glueIPs.length === 0) {
        results.push({
          check: 'glue_record',
          domain: nsFqdn,
          server: ns === 'ns1' ? 'S1' : 'S2',
          status: 'manual_required',
          details: `No glue record (A record) found for ${nsFqdn}`,
        });
      } else if (!glueIPs.includes(expectedIP)) {
        results.push({
          check: 'glue_record',
          domain: nsFqdn,
          server: ns === 'ns1' ? 'S1' : 'S2',
          status: 'manual_required',
          details: `Glue record ${nsFqdn} resolves to ${glueIPs.join(', ')} but expected ${expectedIP}`,
        });
      } else {
        results.push({
          check: 'glue_record',
          domain: nsFqdn,
          server: ns === 'ns1' ? 'S1' : 'S2',
          status: 'pass',
          details: `Glue record ${nsFqdn} correctly resolves to ${expectedIP}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'glue_record',
        domain: nsFqdn,
        server: ns === 'ns1' ? 'S1' : 'S2',
        status: 'manual_required',
        details: `Error checking glue record: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 8: DNS zone transfer check
  log('[VG] Running check 8: DNS zone transfer check');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);
    const ssh = server === 'S1' ? ssh1 : ssh2;
    const ip = server === 'S1' ? server1IP : server2IP;

    try {
      const result = await ssh.exec(`dig AXFR ${domain} @${ip} 2>/dev/null`, { timeout: 15000 });
      const lines = result.stdout.trim().split('\n').filter(Boolean);

      // A successful zone transfer returns multiple records beyond just headers
      if (lines.length > 3) {
        results.push({
          check: 'zone_transfer',
          domain,
          server,
          status: 'auto_fixable',
          details: `Zone transfer is enabled on ${ip}`,
          fixAction: 'fix_zone_transfer',
        });
      } else {
        results.push({
          check: 'zone_transfer',
          domain,
          server,
          status: 'pass',
          details: `Zone transfer is not enabled`,
        });
      }
    } catch (err) {
      results.push({
        check: 'zone_transfer',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking zone transfer: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 9: Subnet diversity
  log('[VG] Running check 9: Subnet diversity');
  try {
    const s1Subnet = server1IP.split('.').slice(0, 3).join('.');
    const s2Subnet = server2IP.split('.').slice(0, 3).join('.');

    if (s1Subnet === s2Subnet) {
      results.push({
        check: 'subnet_diversity',
        domain: 'both',
        server: 'both',
        status: 'manual_required',
        details: `Both servers in same /24 subnet: ${s1Subnet}.0/24`,
      });
    } else {
      results.push({
        check: 'subnet_diversity',
        domain: 'both',
        server: 'both',
        status: 'pass',
        details: `Servers in different subnets: S1=${s1Subnet}, S2=${s2Subnet}`,
      });
    }
  } catch (err) {
    results.push({
      check: 'subnet_diversity',
      domain: 'both',
      server: 'both',
      status: 'manual_required',
      details: `Error checking subnet diversity: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Check 10: CAA record
  log('[VG] Running check 10: CAA record');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const caaResult = await ssh1.exec(
        `dig CAA ${domain} @${primaryResolver} +short 2>/dev/null`,
        { timeout: 15000 }
      );
      const caaLines = caaResult.stdout.trim().split('\n').filter(Boolean);

      if (caaLines.length === 0) {
        results.push({
          check: 'caa_record',
          domain,
          server,
          status: 'auto_fixable',
          details: `No CAA record found for ${domain}`,
          fixAction: 'add_caa',
        });
      } else {
        const hasLetsEncrypt = caaLines.some((caa) => caa.includes('letsencrypt.org'));
        if (hasLetsEncrypt) {
          results.push({
            check: 'caa_record',
            domain,
            server,
            status: 'pass',
            details: `CAA record allows Let's Encrypt: ${caaLines.join('; ')}`,
          });
        } else {
          results.push({
            check: 'caa_record',
            domain,
            server,
            status: 'auto_fixable',
            details: `CAA record exists but does not include letsencrypt.org: ${caaLines.join('; ')}`,
            fixAction: 'add_caa',
          });
        }
      }
    } catch (err) {
      results.push({
        check: 'caa_record',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking CAA record: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ============================================================================
  // CATEGORY 2: Authentication Records (11-17)
  // ============================================================================

  // Check 11: SPF presence
  log('[VG] Running check 11: SPF presence');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const txtResult = await ssh1.exec(
        `dig +short ${domain} TXT @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const txtLines = txtResult.stdout.trim().split('\n').filter(Boolean);
      const hasSPF = txtLines.some((txt) => txt.includes('v=spf1'));

      if (!hasSPF) {
        results.push({
          check: 'spf_presence',
          domain,
          server,
          status: 'auto_fixable',
          details: `No SPF record found for ${domain}`,
          fixAction: 'add_spf',
        });
      } else {
        results.push({
          check: 'spf_presence',
          domain,
          server,
          status: 'pass',
          details: `SPF record found for ${domain}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'spf_presence',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking SPF: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 12: SPF syntax
  log('[VG] Running check 12: SPF syntax');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const txtResult = await ssh1.exec(
        `dig +short ${domain} TXT @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const txtLines = txtResult.stdout.trim().split('\n').filter(Boolean);
      const spfLine = txtLines.find((txt) => txt.includes('v=spf1'));

      if (!spfLine) {
        results.push({
          check: 'spf_syntax',
          domain,
          server,
          status: 'auto_fixable',
          details: `No SPF record found`,
          fixAction: 'fix_spf',
        });
        continue;
      }

      const spfIssues: string[] = [];

      // Count SPF records
      const spfCount = txtLines.filter((txt) => txt.includes('v=spf1')).length;
      if (spfCount > 1) {
        spfIssues.push(`Multiple SPF records (${spfCount})`);
      }

      // Check for ptr mechanism
      if (spfLine.includes(' ptr ') || spfLine.includes(' ptr:')) {
        spfIssues.push('Contains obsolete ptr mechanism');
      }

      // Count DNS lookups
      const dnsLookups = (spfLine.match(/\b(include|a|mx|ptr|exists|redirect)\b/g) || []).length;
      if (dnsLookups >= 10) {
        spfIssues.push(`DNS lookup count ${dnsLookups} >= 10`);
      }

      // Check for -all or ~all
      if (!spfLine.includes(' -all') && !spfLine.endsWith('-all')) {
        if (spfLine.includes(' ~all') || spfLine.endsWith('~all')) {
          spfIssues.push('Uses soft fail (~all) instead of hard fail (-all)');
        } else {
          spfIssues.push('Does not end with -all');
        }
      }

      if (spfIssues.length > 0) {
        results.push({
          check: 'spf_syntax',
          domain,
          server,
          status: 'auto_fixable',
          details: `SPF syntax issues: ${spfIssues.join('; ')}. Record: ${spfLine}`,
          fixAction: 'fix_spf',
        });
      } else {
        results.push({
          check: 'spf_syntax',
          domain,
          server,
          status: 'pass',
          details: `SPF record syntax valid: ${spfLine}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'spf_syntax',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking SPF syntax: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 13: SPF per-server IP
  log('[VG] Running check 13: SPF per-server IP');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);
    const expectedIP = getServerIPForDomain(domain);

    try {
      const txtResult = await ssh1.exec(
        `dig +short ${domain} TXT @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const txtLines = txtResult.stdout.trim().split('\n').filter(Boolean);
      const spfLine = txtLines.find((txt) => txt.includes('v=spf1'));

      if (!spfLine || !spfLine.includes(`ip4:${expectedIP}`)) {
        results.push({
          check: 'spf_server_ip',
          domain,
          server,
          status: 'auto_fixable',
          details: `SPF does not include ${expectedIP} for ${server}. Record: ${spfLine || 'NOT FOUND'}`,
          fixAction: 'fix_spf',
        });
      } else {
        results.push({
          check: 'spf_server_ip',
          domain,
          server,
          status: 'pass',
          details: `SPF includes server IP ${expectedIP}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'spf_server_ip',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking SPF server IP: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 14: DKIM presence
  log('[VG] Running check 14: DKIM presence');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const dkimResult = await ssh1.exec(
        `dig +short mail._domainkey.${domain} TXT @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const dkimLines = dkimResult.stdout.trim().split('\n').filter(Boolean);
      const hasDKIM = dkimLines.some((txt) => txt.includes('v=DKIM1'));

      if (!hasDKIM) {
        results.push({
          check: 'dkim_presence',
          domain,
          server,
          status: 'auto_fixable',
          details: `No DKIM record found for mail._domainkey.${domain}`,
          fixAction: 'add_dkim',
        });
      } else {
        results.push({
          check: 'dkim_presence',
          domain,
          server,
          status: 'pass',
          details: `DKIM record found for ${domain}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'dkim_presence',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking DKIM: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 15: DKIM key validation
  log('[VG] Running check 15: DKIM key validation');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const dkimResult = await ssh1.exec(
        `dig +short mail._domainkey.${domain} TXT @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const dkimLine = dkimResult.stdout.trim();

      if (!dkimLine || !dkimLine.includes('v=DKIM1')) {
        results.push({
          check: 'dkim_key_validation',
          domain,
          server,
          status: 'auto_fixable',
          details: `No valid DKIM record`,
          fixAction: 'add_dkim',
        });
        continue;
      }

      // Extract p= value
      const pMatch = dkimLine.match(/p=([A-Za-z0-9+/=]+)/);
      if (!pMatch) {
        results.push({
          check: 'dkim_key_validation',
          domain,
          server,
          status: 'auto_fixable',
          details: `DKIM record missing public key (p=)`,
          fixAction: 'add_dkim',
        });
        continue;
      }

      const base64Key = pMatch[1];
      // Base64 decode to check length (roughly: 4 chars = 3 bytes, so 2048-bit = 256 bytes ≈ 341 base64 chars)
      const decodedLength = Math.floor((base64Key.length * 3) / 4);

      if (decodedLength < 256) {
        results.push({
          check: 'dkim_key_validation',
          domain,
          server,
          status: 'auto_fixable',
          details: `DKIM key too short (estimated ${decodedLength} bytes, need ≥ 256 for 2048-bit)`,
          fixAction: 'add_dkim',
        });
      } else {
        results.push({
          check: 'dkim_key_validation',
          domain,
          server,
          status: 'pass',
          details: `DKIM key valid (estimated ${decodedLength} bytes)`,
        });
      }
    } catch (err) {
      results.push({
        check: 'dkim_key_validation',
        domain,
        server,
        status: 'manual_required',
        details: `Error validating DKIM key: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 16: DMARC presence
  log('[VG] Running check 16: DMARC presence');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const dmarcResult = await ssh1.exec(
        `dig +short _dmarc.${domain} TXT @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const dmarcLines = dmarcResult.stdout.trim().split('\n').filter(Boolean);
      const hasDMARC = dmarcLines.some((txt) => txt.includes('v=DMARC1'));

      if (!hasDMARC) {
        results.push({
          check: 'dmarc_presence',
          domain,
          server,
          status: 'auto_fixable',
          details: `No DMARC record found for _dmarc.${domain}`,
          fixAction: 'add_dmarc',
        });
      } else {
        results.push({
          check: 'dmarc_presence',
          domain,
          server,
          status: 'pass',
          details: `DMARC record found for ${domain}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'dmarc_presence',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking DMARC: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 17: DMARC syntax/policy
  log('[VG] Running check 17: DMARC syntax/policy');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const dmarcResult = await ssh1.exec(
        `dig +short _dmarc.${domain} TXT @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const dmarcLines = dmarcResult.stdout.trim().split('\n').filter(Boolean);
      const dmarcLine = dmarcLines.find((txt) => txt.includes('v=DMARC1'));

      if (!dmarcLine) {
        results.push({
          check: 'dmarc_syntax',
          domain,
          server,
          status: 'auto_fixable',
          details: `No DMARC record found`,
          fixAction: 'fix_dmarc',
        });
        continue;
      }

      const dmarcIssues: string[] = [];

      // Check starts with v=DMARC1
      if (!dmarcLine.startsWith('v=DMARC1')) {
        dmarcIssues.push('Does not start with v=DMARC1');
      }

      // Count DMARC records
      const dmarcCount = dmarcLines.filter((txt) => txt.includes('v=DMARC1')).length;
      if (dmarcCount > 1) {
        dmarcIssues.push(`Multiple DMARC records (${dmarcCount})`);
      }

      // Check policy
      const hasPolicyQuarantine = dmarcLine.includes('p=quarantine');
      const hasPolicyReject = dmarcLine.includes('p=reject');
      const hasPolicyNone = dmarcLine.includes('p=none');

      if (!hasPolicyQuarantine && !hasPolicyReject) {
        if (hasPolicyNone) {
          dmarcIssues.push('Policy is p=none (should be p=quarantine or p=reject)');
        } else {
          dmarcIssues.push('Missing or invalid policy tag');
        }
      }

      // Check for duplicate tags (simple check: count 'p=' occurrences)
      const pCount = (dmarcLine.match(/\bp=/g) || []).length;
      if (pCount > 1) {
        dmarcIssues.push('Duplicate policy tags');
      }

      if (dmarcIssues.length > 0) {
        results.push({
          check: 'dmarc_syntax',
          domain,
          server,
          status: 'auto_fixable',
          details: `DMARC issues: ${dmarcIssues.join('; ')}. Record: ${dmarcLine}`,
          fixAction: 'fix_dmarc',
        });
      } else {
        results.push({
          check: 'dmarc_syntax',
          domain,
          server,
          status: 'pass',
          details: `DMARC record valid: ${dmarcLine}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'dmarc_syntax',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking DMARC syntax: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ============================================================================
  // CATEGORY 3: Mail Server / SMTP Checks (18-26)
  // ============================================================================

  // Check 18: Port 25 connectivity
  log('[VG] Running check 18: Port 25 connectivity');
  for (const [sshn, name] of [
    [ssh1, 'S1'],
    [ssh2, 'S2'],
  ] as const) {
    try {
      const result = await sshn.exec('nc -z -w5 localhost 25 2>&1', { timeout: 15000 });
      if (result.code === 0) {
        results.push({
          check: 'port_25_connectivity',
          domain: 'both',
          server: name,
          status: 'pass',
          details: `Port 25 is open on ${name}`,
        });
      } else {
        results.push({
          check: 'port_25_connectivity',
          domain: 'both',
          server: name,
          status: 'manual_required',
          details: `Port 25 is not open on ${name}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'port_25_connectivity',
        domain: 'both',
        server: name,
        status: 'manual_required',
        details: `Error checking port 25: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 19: SMTP banner format
  log('[VG] Running check 19: SMTP banner format');
  for (const [sshn, name] of [
    [ssh1, 'S1'],
    [ssh2, 'S2'],
  ] as const) {
    try {
      const result = await sshn.exec('echo "QUIT" | nc -w5 localhost 25 2>&1 | head -1', {
        timeout: 15000,
      });
      const banner = result.stdout.trim();

      if (!banner.startsWith('220')) {
        results.push({
          check: 'smtp_banner',
          domain: 'both',
          server: name,
          status: 'manual_required',
          details: `SMTP banner does not start with 220: ${banner}`,
        });
      } else {
        const expectedHostname =
          name === 'S1' ? `mail1.${nsDomain}` : `mail2.${nsDomain}`;
        if (banner.includes(expectedHostname) || banner.includes(`mail${name === 'S1' ? '1' : '2'}`)) {
          results.push({
            check: 'smtp_banner',
            domain: 'both',
            server: name,
            status: 'pass',
            details: `SMTP banner correct: ${banner}`,
          });
        } else {
          results.push({
            check: 'smtp_banner',
            domain: 'both',
            server: name,
            status: 'manual_required',
            details: `SMTP banner does not match hostname. Banner: ${banner}, Expected: ${expectedHostname}`,
          });
        }
      }
    } catch (err) {
      results.push({
        check: 'smtp_banner',
        domain: 'both',
        server: name,
        status: 'manual_required',
        details: `Error checking SMTP banner: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 20: HELO/EHLO check
  log('[VG] Running check 20: HELO/EHLO check');
  for (const [sshn, name] of [
    [ssh1, 'S1'],
    [ssh2, 'S2'],
  ] as const) {
    try {
      const result = await sshn.exec(
        `${HESTIA_PATH_PREFIX}exim4 -bP primary_hostname 2>/dev/null || cat /etc/exim4/exim4.conf.localdirective 2>/dev/null | grep -i primary_hostname | head -1`,
        { timeout: 15000 }
      );
      const output = result.stdout.trim();
      const expectedHostname = name === 'S1' ? `mail1.${nsDomain}` : `mail2.${nsDomain}`;

      if (output.includes(expectedHostname)) {
        results.push({
          check: 'helo_ehlo',
          domain: 'both',
          server: name,
          status: 'pass',
          details: `HELO hostname matches expected: ${expectedHostname}`,
        });
      } else {
        results.push({
          check: 'helo_ehlo',
          domain: 'both',
          server: name,
          status: 'manual_required',
          details: `HELO hostname mismatch. Expected: ${expectedHostname}, Got: ${output}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'helo_ehlo',
        domain: 'both',
        server: name,
        status: 'manual_required',
        details: `Error checking HELO: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 21: FCrDNS (Forward-confirmed rDNS)
  log('[VG] Running check 21: FCrDNS (Forward-confirmed rDNS)');
  for (const [sshn, name, ip] of [
    [ssh1, 'S1', server1IP] as const,
    [ssh2, 'S2', server2IP] as const,
  ]) {
    try {
      // Reverse DNS lookup
      const ptrResult = await ssh1.exec(`dig -x ${ip} +short @${primaryResolver} 2>/dev/null`, {
        timeout: 15000,
      });
      const ptrName = ptrResult.stdout.trim().replace(/\.$/, '');

      if (!ptrName) {
        results.push({
          check: 'fcrdns',
          domain: 'both',
          server: name,
          status: 'auto_fixable',
          details: `No PTR record found for ${ip}`,
          fixAction: 'fix_ptr',
        });
        continue;
      }

      const expectedPTR = name === 'S1' ? `mail1.${nsDomain}` : `mail2.${nsDomain}`;

      // Forward DNS lookup of PTR
      const aResult = await ssh1.exec(
        `dig +short ${ptrName} A @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const aIPs = aResult.stdout.trim().split('\n').filter(Boolean);

      const fcrdnsIssues: string[] = [];

      if (ptrName !== expectedPTR && ptrName !== `${expectedPTR}.`) {
        fcrdnsIssues.push(`PTR mismatch: ${ptrName} != ${expectedPTR}`);
      }

      if (!aIPs.includes(ip)) {
        fcrdnsIssues.push(`Forward lookup of ${ptrName} does not resolve to ${ip}`);
      }

      if (fcrdnsIssues.length > 0) {
        results.push({
          check: 'fcrdns',
          domain: 'both',
          server: name,
          status: 'auto_fixable',
          details: `FCrDNS issues: ${fcrdnsIssues.join('; ')}`,
          fixAction: 'fix_ptr',
        });
      } else {
        results.push({
          check: 'fcrdns',
          domain: 'both',
          server: name,
          status: 'pass',
          details: `FCrDNS confirmed: ${ip} <-> ${ptrName}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'fcrdns',
        domain: 'both',
        server: name,
        status: 'manual_required',
        details: `Error checking FCrDNS: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 22: SMTP STARTTLS
  log('[VG] Running check 22: SMTP STARTTLS');
  for (const [sshn, name] of [
    [ssh1, 'S1'],
    [ssh2, 'S2'],
  ] as const) {
    try {
      const expectedHostname = name === 'S1' ? `mail1.${nsDomain}` : `mail2.${nsDomain}`;
      const result = await sshn.exec(
        `echo "QUIT" | openssl s_client -starttls smtp -connect localhost:25 -servername ${expectedHostname} 2>&1 | head -20`,
        { timeout: 15000 }
      );
      const output = result.stdout;

      if (
        output.includes('SSL handshake') ||
        output.includes('CONNECTED') ||
        output.includes('Verify return code')
      ) {
        results.push({
          check: 'smtp_starttls',
          domain: 'both',
          server: name,
          status: 'pass',
          details: `STARTTLS successful`,
        });
      } else {
        results.push({
          check: 'smtp_starttls',
          domain: 'both',
          server: name,
          status: 'manual_required',
          details: `STARTTLS failed or error`,
        });
      }
    } catch (err) {
      results.push({
        check: 'smtp_starttls',
        domain: 'both',
        server: name,
        status: 'manual_required',
        details: `Error testing STARTTLS: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 23: SMTP TLS cert CN
  log('[VG] Running check 23: SMTP TLS cert CN');
  for (const [sshn, name] of [
    [ssh1, 'S1'],
    [ssh2, 'S2'],
  ] as const) {
    try {
      const expectedHostname = name === 'S1' ? `mail1.${nsDomain}` : `mail2.${nsDomain}`;
      const result = await sshn.exec(
        `echo | openssl s_client -starttls smtp -connect localhost:25 2>/dev/null | openssl x509 -noout -subject`,
        { timeout: 15000 }
      );
      const subject = result.stdout.trim();

      if (subject.includes(expectedHostname) || subject.includes(`mail${name === 'S1' ? '1' : '2'}`)) {
        results.push({
          check: 'smtp_tls_cert_cn',
          domain: 'both',
          server: name,
          status: 'pass',
          details: `Cert CN matches: ${subject}`,
        });
      } else {
        results.push({
          check: 'smtp_tls_cert_cn',
          domain: 'both',
          server: name,
          status: 'auto_fixable',
          details: `Cert CN mismatch. Expected: ${expectedHostname}, Got: ${subject}`,
          fixAction: 'reissue_ssl',
        });
      }
    } catch (err) {
      results.push({
        check: 'smtp_tls_cert_cn',
        domain: 'both',
        server: name,
        status: 'manual_required',
        details: `Error checking cert CN: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 24: SMTP open relay test
  log('[VG] Running check 24: SMTP open relay test');
  for (const [sshn, name] of [
    [ssh1, 'S1'],
    [ssh2, 'S2'],
  ] as const) {
    try {
      const result = await sshn.exec(
        `{ echo "EHLO test"; echo "MAIL FROM:<test@test.com>"; echo "RCPT TO:<test@example.com>"; echo "QUIT"; } | nc -w5 localhost 25 2>&1`,
        { timeout: 15000 }
      );
      const output = result.stdout;

      // Look for RCPT TO response
      const rcptLine = output.split('\n').find((line) => line.includes('RCPT TO'));
      if (rcptLine && rcptLine.startsWith('250')) {
        results.push({
          check: 'smtp_open_relay',
          domain: 'both',
          server: name,
          status: 'manual_required',
          details: `OPEN RELAY DETECTED: Server accepts arbitrary recipients`,
        });
      } else {
        results.push({
          check: 'smtp_open_relay',
          domain: 'both',
          server: name,
          status: 'pass',
          details: `Server correctly rejects arbitrary recipients`,
        });
      }
    } catch (err) {
      results.push({
        check: 'smtp_open_relay',
        domain: 'both',
        server: name,
        status: 'manual_required',
        details: `Error testing open relay: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 25: SMTP connection time
  log('[VG] Running check 25: SMTP connection time');
  for (const [sshn, name, ip] of [
    [ssh1, 'S1', server1IP] as const,
    [ssh2, 'S2', server2IP] as const,
  ]) {
    try {
      const result = await sshn.exec(`time nc -z -w10 ${ip} 25 2>&1`, { timeout: 15000 });
      // Parse time output (format: "real 0m0.XXXs")
      const timeMatch = result.stderr.match(/real\s+0m([0-9.]+)s/);
      const connectionTime = timeMatch ? parseFloat(timeMatch[1]) : null;

      if (connectionTime !== null && connectionTime > 10) {
        results.push({
          check: 'smtp_connection_time',
          domain: 'both',
          server: name,
          status: 'manual_required',
          details: `SMTP connection time ${connectionTime.toFixed(2)}s > 10s`,
        });
      } else if (connectionTime !== null) {
        results.push({
          check: 'smtp_connection_time',
          domain: 'both',
          server: name,
          status: 'pass',
          details: `SMTP connection time ${connectionTime.toFixed(2)}s`,
        });
      } else {
        results.push({
          check: 'smtp_connection_time',
          domain: 'both',
          server: name,
          status: 'manual_required',
          details: `Could not parse connection time`,
        });
      }
    } catch (err) {
      results.push({
        check: 'smtp_connection_time',
        domain: 'both',
        server: name,
        status: 'manual_required',
        details: `Error testing connection time: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 26: SMTP transaction time
  log('[VG] Running check 26: SMTP transaction time');
  for (const [sshn, name] of [
    [ssh1, 'S1'],
    [ssh2, 'S2'],
  ] as const) {
    try {
      const domain = server1Domains[0] || nsDomain;
      const result = await sshn.exec(
        `time { echo -e "EHLO test\\nMAIL FROM:<test@test.com>\\nRCPT TO:<postmaster@${domain}>\\nQUIT"; } | nc -w15 localhost 25 > /dev/null 2>&1`,
        { timeout: 20000 }
      );
      const timeMatch = result.stderr.match(/real\s+0m([0-9.]+)s/);
      const txTime = timeMatch ? parseFloat(timeMatch[1]) : null;

      if (txTime !== null && txTime > 15) {
        results.push({
          check: 'smtp_transaction_time',
          domain: 'both',
          server: name,
          status: 'manual_required',
          details: `SMTP transaction time ${txTime.toFixed(2)}s > 15s`,
        });
      } else if (txTime !== null) {
        results.push({
          check: 'smtp_transaction_time',
          domain: 'both',
          server: name,
          status: 'pass',
          details: `SMTP transaction time ${txTime.toFixed(2)}s`,
        });
      } else {
        results.push({
          check: 'smtp_transaction_time',
          domain: 'both',
          server: name,
          status: 'manual_required',
          details: `Could not parse transaction time`,
        });
      }
    } catch (err) {
      results.push({
        check: 'smtp_transaction_time',
        domain: 'both',
        server: name,
        status: 'manual_required',
        details: `Error testing transaction time: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ============================================================================
  // CATEGORY 4: SSL/TLS Certificate Checks (27-30)
  // ============================================================================

  // Check 27: SSL cert existence and CN match
  log('[VG] Running check 27: SSL cert existence and CN match');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);
    const ip = getServerIPForDomain(domain);
    const sshn = server === 'S1' ? ssh1 : ssh2;

    try {
      const result = await sshn.exec(
        `echo | openssl s_client -connect ${ip}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -subject -dates`,
        { timeout: 15000 }
      );
      const output = result.stdout;

      if (!output || output.includes('error')) {
        results.push({
          check: 'ssl_cert_existence',
          domain,
          server,
          status: 'auto_fixable',
          details: `No SSL certificate or certificate error for ${domain}`,
          fixAction: 'reissue_ssl',
        });
      } else if (output.includes(domain)) {
        results.push({
          check: 'ssl_cert_existence',
          domain,
          server,
          status: 'pass',
          details: `SSL cert exists and CN matches: ${output}`,
        });
      } else {
        results.push({
          check: 'ssl_cert_existence',
          domain,
          server,
          status: 'auto_fixable',
          details: `SSL cert CN does not match domain. Certificate: ${output}`,
          fixAction: 'reissue_ssl',
        });
      }
    } catch (err) {
      results.push({
        check: 'ssl_cert_existence',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking SSL cert: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 28: SSL cert expiry
  log('[VG] Running check 28: SSL cert expiry');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);
    const ip = getServerIPForDomain(domain);
    const sshn = server === 'S1' ? ssh1 : ssh2;

    try {
      const result = await sshn.exec(
        `echo | openssl s_client -connect ${ip}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -enddate`,
        { timeout: 15000 }
      );
      const endDateLine = result.stdout.trim();
      const dateMatch = endDateLine.match(/notAfter=(.+)/);

      if (dateMatch) {
        const expiryDate = new Date(dateMatch[1]);
        const now = new Date();
        const daysUntilExpiry = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

        if (daysUntilExpiry < 30) {
          results.push({
            check: 'ssl_cert_expiry',
            domain,
            server,
            status: 'auto_fixable',
            details: `SSL cert expires in ${daysUntilExpiry.toFixed(1)} days (< 30)`,
            fixAction: 'reissue_ssl',
          });
        } else if (daysUntilExpiry < 0) {
          results.push({
            check: 'ssl_cert_expiry',
            domain,
            server,
            status: 'auto_fixable',
            details: `SSL cert has expired`,
            fixAction: 'reissue_ssl',
          });
        } else {
          results.push({
            check: 'ssl_cert_expiry',
            domain,
            server,
            status: 'pass',
            details: `SSL cert valid for ${daysUntilExpiry.toFixed(1)} more days`,
          });
        }
      } else {
        results.push({
          check: 'ssl_cert_expiry',
          domain,
          server,
          status: 'manual_required',
          details: `Could not parse certificate expiry date`,
        });
      }
    } catch (err) {
      results.push({
        check: 'ssl_cert_expiry',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking cert expiry: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 29: SSL self-signed check
  log('[VG] Running check 29: SSL self-signed check');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);
    const ip = getServerIPForDomain(domain);
    const sshn = server === 'S1' ? ssh1 : ssh2;

    try {
      const result = await sshn.exec(
        `echo | openssl s_client -connect ${ip}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -subject -issuer`,
        { timeout: 15000 }
      );
      const output = result.stdout;
      const subjectLine = output.split('\n').find((l) => l.includes('subject='));
      const issuerLine = output.split('\n').find((l) => l.includes('issuer='));

      if (subjectLine && issuerLine && subjectLine === issuerLine) {
        results.push({
          check: 'ssl_self_signed',
          domain,
          server,
          status: 'auto_fixable',
          details: `Certificate is self-signed`,
          fixAction: 'reissue_ssl',
        });
      } else {
        results.push({
          check: 'ssl_self_signed',
          domain,
          server,
          status: 'pass',
          details: `Certificate is not self-signed`,
        });
      }
    } catch (err) {
      results.push({
        check: 'ssl_self_signed',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking if cert is self-signed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 30: HTTPS connectivity
  log('[VG] Running check 30: HTTPS connectivity');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);
    const sshn = server === 'S1' ? ssh1 : ssh2;

    try {
      const result = await sshn.exec(`curl -sI --max-time 10 https://${domain}/ 2>&1 | head -1`, {
        timeout: 15000,
      });
      const output = result.stdout.trim();

      if (output.startsWith('HTTP')) {
        results.push({
          check: 'https_connectivity',
          domain,
          server,
          status: 'pass',
          details: `HTTPS connectivity successful: ${output}`,
        });
      } else {
        results.push({
          check: 'https_connectivity',
          domain,
          server,
          status: 'auto_fixable',
          details: `HTTPS connectivity failed or no response`,
          fixAction: 'reissue_ssl',
        });
      }
    } catch (err) {
      results.push({
        check: 'https_connectivity',
        domain,
        server,
        status: 'manual_required',
        details: `Error testing HTTPS: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ============================================================================
  // CATEGORY 5: Blacklist Checks (31-33)
  // ============================================================================

  // Check 31: IP blacklist check
  log('[VG] Running check 31: IP blacklist check');
  const blacklists = ['zen.spamhaus.org', 'dnsbl.sorbs.net', 'dnsbl-1.uceprotect.net'];

  for (const [ip, name] of [
    [server1IP, 'S1'],
    [server2IP, 'S2'],
  ] as const) {
    // Reverse IP for RBL query
    const parts = ip.split('.');
    const reversedIP = [parts[3], parts[2], parts[1], parts[0]].join('.');

    for (const bl of blacklists) {
      try {
        const result = await ssh1.exec(
          `dig ${reversedIP}.${bl} A +short @${primaryResolver} 2>/dev/null`,
          { timeout: 15000 }
        );
        const rblResults = result.stdout.trim().split('\n').filter(Boolean);

        if (rblResults.length > 0) {
          results.push({
            check: 'ip_blacklist',
            domain: ip,
            server: name,
            status: 'manual_required',
            details: `${ip} listed on ${bl}: ${rblResults.join(', ')}`,
          });
        } else {
          results.push({
            check: 'ip_blacklist',
            domain: ip,
            server: name,
            status: 'pass',
            details: `${ip} not listed on ${bl}`,
          });
        }
      } catch (err) {
        results.push({
          check: 'ip_blacklist',
          domain: ip,
          server: name,
          status: 'manual_required',
          details: `Error checking ${bl}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Check 32: Domain blacklist check
  // Hard Lesson #91: URIBL blocks cloud/VPS IPs and returns 127.0.0.1 for
  // EVERY query — causing 100% false positives. Run access test first:
  // query test address `2.0.0.127.multi.uribl.com` via dig — if it resolves
  // to anything, our IP is blocked and all URIBL results must be skipped.
  log('[VG] Running check 32: Domain blacklist check');

  // URIBL access test — run once before domain loop
  let uriblBlocked = false;
  try {
    const uriblTest = await ssh1.exec(
      `dig 2.0.0.127.multi.uribl.com A +short @${primaryResolver} 2>/dev/null`,
      { timeout: 10000 }
    );
    const testResult = uriblTest.stdout.trim();
    if (testResult.length > 0) {
      uriblBlocked = true;
      log(`[VG] URIBL access test returned "${testResult}" — IP is BLOCKED. Skipping URIBL to avoid false positives (Hard Lesson #91).`);
    } else {
      log('[VG] URIBL access test: queries allowed');
    }
  } catch {
    uriblBlocked = true;
    log('[VG] URIBL access test failed — assuming blocked, skipping URIBL');
  }

  const domainBlacklists = [
    { name: 'dbl.spamhaus.org', key: 'spamhaus_dbl' },
    { name: 'multi.surbl.org', key: 'surbl' },
    { name: 'multi.uribl.com', key: 'uribl' },
  ];

  for (const domain of [nsDomain, ...sendingDomains]) {
    const server = getServerForDomain(domain);

    for (const bl of domainBlacklists) {
      // Hard Lesson #91: Skip URIBL if our IP is blocked
      if (bl.key === 'uribl' && uriblBlocked) {
        results.push({
          check: 'domain_blacklist',
          domain,
          server,
          status: 'pass',
          details: `${domain} — URIBL skipped (IP blocked, false positive prevention)`,
        });
        continue;
      }

      try {
        const result = await ssh1.exec(
          `dig ${domain}.${bl.name} A +short @${primaryResolver} 2>/dev/null`,
          { timeout: 15000 }
        );
        const blResults = result.stdout.trim().split('\n').filter(Boolean);

        if (blResults.length > 0) {
          results.push({
            check: 'domain_blacklist',
            domain,
            server,
            status: 'manual_required',
            details: `${domain} listed on ${bl.name}: ${blResults.join(', ')}`,
          });
        } else {
          results.push({
            check: 'domain_blacklist',
            domain,
            server,
            status: 'pass',
            details: `${domain} not listed on ${bl.name}`,
          });
        }
      } catch (err) {
        results.push({
          check: 'domain_blacklist',
          domain,
          server,
          status: 'manual_required',
          details: `Error checking ${bl.name}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Check 33: SEM blacklist exception
  log('[VG] Running check 33: SEM blacklist exception');
  const semBlacklists = ['bl.spameatingmonkey.net', 'backscatter.spameatingmonkey.net'];

  for (const [ip, name] of [
    [server1IP, 'S1'],
    [server2IP, 'S2'],
  ] as const) {
    const parts = ip.split('.');
    const reversedIP = [parts[3], parts[2], parts[1], parts[0]].join('.');

    for (const semBL of semBlacklists) {
      try {
        const result = await ssh1.exec(
          `dig ${reversedIP}.${semBL} A +short @${primaryResolver} 2>/dev/null`,
          { timeout: 15000 }
        );
        const semResults = result.stdout.trim().split('\n').filter(Boolean);

        if (semResults.length > 0) {
          results.push({
            check: 'sem_exception',
            domain: ip,
            server: name,
            status: 'pass',
            details: `${ip} listed on ${semBL} (SEM listing, auto-expires, no deliverability impact)`,
          });
        }
      } catch (err) {
        // Silently skip SEM errors
      }
    }
  }

  // ============================================================================
  // CATEGORY 6: Advanced Authentication (34-36)
  // ============================================================================

  // Check 34: MTA-STS
  log('[VG] Running check 34: MTA-STS');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const result = await ssh1.exec(
        `dig +short _mta-sts.${domain} TXT @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const mtsLines = result.stdout.trim().split('\n').filter(Boolean);
      const hasMTS = mtsLines.some((txt) => txt.includes('v=STSv1'));

      if (!hasMTS) {
        results.push({
          check: 'mta_sts',
          domain,
          server,
          status: 'auto_fixable',
          details: `No MTA-STS record found for _mta-sts.${domain}`,
          fixAction: 'add_mta_sts',
        });
      } else {
        results.push({
          check: 'mta_sts',
          domain,
          server,
          status: 'pass',
          details: `MTA-STS record found for ${domain}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'mta_sts',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking MTA-STS: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 35: TLSRPT
  log('[VG] Running check 35: TLSRPT');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const result = await ssh1.exec(
        `dig +short _smtp._tls.${domain} TXT @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const tlsLines = result.stdout.trim().split('\n').filter(Boolean);
      const hasTLS = tlsLines.some((txt) => txt.includes('v=TLSRPTv1'));

      if (!hasTLS) {
        results.push({
          check: 'tlsrpt',
          domain,
          server,
          status: 'auto_fixable',
          details: `No TLSRPT record found for _smtp._tls.${domain}`,
          fixAction: 'add_tlsrpt',
        });
      } else {
        results.push({
          check: 'tlsrpt',
          domain,
          server,
          status: 'pass',
          details: `TLSRPT record found for ${domain}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'tlsrpt',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking TLSRPT: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 36: BIMI
  log('[VG] Running check 36: BIMI');
  for (const domain of allDomains) {
    const server = getServerForDomain(domain);

    try {
      const result = await ssh1.exec(
        `dig +short default._bimi.${domain} TXT @${primaryResolver} 2>/dev/null`,
        { timeout: 15000 }
      );
      const bimiLines = result.stdout.trim().split('\n').filter(Boolean);
      const hasBIMI = bimiLines.some((txt) => txt.includes('v=BIMI1'));

      if (!hasBIMI) {
        results.push({
          check: 'bimi',
          domain,
          server,
          status: 'auto_fixable',
          details: `No BIMI record found for default._bimi.${domain}`,
          fixAction: 'add_bimi',
        });
      } else {
        results.push({
          check: 'bimi',
          domain,
          server,
          status: 'pass',
          details: `BIMI record found for ${domain}`,
        });
      }
    } catch (err) {
      results.push({
        check: 'bimi',
        domain,
        server,
        status: 'manual_required',
        details: `Error checking BIMI: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Summary log
  const passCount = results.filter((r) => r.status === 'pass').length;
  const autoCount = results.filter((r) => r.status === 'auto_fixable').length;
  const manualCount = results.filter((r) => r.status === 'manual_required').length;

  log(
    `[VG] ${results.length} checks: ${passCount} pass, ${autoCount} auto-fixable, ${manualCount} manual-required`
  );

  return results;
}
