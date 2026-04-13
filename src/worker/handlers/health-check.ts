// ============================================
// B15-5: pg-boss handler for 'server-health-check' job
// Runs full DNS verification on a server pair
// ============================================

import { createClient } from '@supabase/supabase-js';
import { DNSVerifier } from '../../lib/provisioning/verification';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

interface HealthCheckPayload {
  serverPairId: string;
}

export async function handleHealthCheck(
  data: HealthCheckPayload
): Promise<void> {
  const { serverPairId } = data;
  const supabase = getSupabase();

  console.log(`[HealthCheck] Starting health check for server pair ${serverPairId}`);

  // Load server pair
  const { data: serverPair, error: spError } = await supabase
    .from('server_pairs')
    .select('*')
    .eq('id', serverPairId)
    .single();

  if (spError || !serverPair) {
    console.error(`[HealthCheck] Server pair ${serverPairId} not found:`, spError?.message);
    return;
  }

  if (!serverPair.s1_ip || !serverPair.s2_ip) {
    console.warn(`[HealthCheck] Server pair ${serverPairId} missing IPs, skipping`);
    return;
  }

  // Load sending domains for this pair
  const { data: sendingDomains } = await supabase
    .from('sending_domains')
    .select('domain')
    .eq('server_pair_id', serverPairId);

  const domainList = sendingDomains?.map((d) => d.domain) || [];

  // Run full health check
  const verifier = new DNSVerifier();
  const report = await verifier.fullHealthCheck({
    server1IP: serverPair.s1_ip,
    server2IP: serverPair.s2_ip,
    nsDomain: serverPair.ns_domain,
    sendingDomains: domainList.filter((d: string) => d !== serverPair.ns_domain),
  });

  console.log(
    `[HealthCheck] Pair ${serverPair.ns_domain}: ${report.overall} (${report.totalIssues} issues)`
  );

  // Update server pair with health results
  const healthStatus =
    report.overall === 'PASS' ? 'healthy' :
    report.overall === 'WARN' ? 'warning' : 'critical';

  await supabase
    .from('server_pairs')
    .update({
      health_status: healthStatus,
      mxtoolbox_errors: report.totalIssues,
      updated_at: new Date().toISOString(),
    })
    .eq('id', serverPairId);

  // Create system alerts for critical issues
  if (report.overall === 'FAIL') {
    const criticalIssues: string[] = [];

    // Check for blacklist listings
    for (const server of report.servers) {
      if (server.blacklist.listed) {
        const listedOn = server.blacklist.blacklists
          .filter((b) => b.listed)
          .map((b) => b.name);
        criticalIssues.push(
          `IP ${server.ip} blacklisted on: ${listedOn.join(', ')}`
        );
      }
    }

    // Check for DNS failures
    for (const domain of report.domains) {
      if (!domain.dns_ok) {
        criticalIssues.push(`DNS failure on ${domain.domain}`);
      }
      if (!domain.blacklist_ok) {
        criticalIssues.push(`Domain ${domain.domain} blacklisted`);
      }
    }

    // Insert system alerts
    for (const issue of criticalIssues) {
      await supabase.from('system_alerts').insert({
        org_id: serverPair.org_id,
        alert_type: 'health_check_failure',
        severity: 'critical',
        title: `Health check failed: ${serverPair.ns_domain}`,
        message: issue,
        metadata: {
          server_pair_id: serverPairId,
          report_timestamp: report.timestamp,
        },
      });
    }

    if (criticalIssues.length > 0) {
      console.warn(
        `[HealthCheck] Created ${criticalIssues.length} critical alerts for ${serverPair.ns_domain}`
      );
    }
  }
}
