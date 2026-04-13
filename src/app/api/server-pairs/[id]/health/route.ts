// ============================================
// B15-5: GET /api/server-pairs/[id]/health
// Run health check on any existing server pair
// Rate limited: 5 checks per pair per hour
// ============================================

import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { DNSVerifier } from '@/lib/provisioning/verification';

export const dynamic = 'force-dynamic';

// Simple in-memory rate limiting (per server pair)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(pairId: string, maxPerHour: number = 5): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(pairId);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(pairId, { count: 1, resetAt: now + 3600000 });
    return true;
  }

  if (entry.count >= maxPerHour) {
    return false;
  }

  entry.count++;
  return true;
}

async function getInternalOrgId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;
  const supabase = await createAdminClient();
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .single();
  return data?.id || null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit check
    if (!checkRateLimit(id)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded — max 5 health checks per pair per hour' },
        { status: 429 }
      );
    }

    const supabase = await createAdminClient();

    // Load server pair with org_id isolation
    const { data: serverPair, error: spError } = await supabase
      .from('server_pairs')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (spError || !serverPair) {
      return NextResponse.json({ error: 'Server pair not found' }, { status: 404 });
    }

    if (!serverPair.s1_ip || !serverPair.s2_ip) {
      return NextResponse.json(
        { error: 'Server pair missing IP addresses' },
        { status: 400 }
      );
    }

    // Load sending domains for this pair
    const { data: sendingDomains } = await supabase
      .from('sending_domains')
      .select('domain')
      .eq('server_pair_id', id)
      .eq('org_id', orgId);

    const domainList = sendingDomains?.map((d) => d.domain) || [];

    // If no sending domains in DB, try to get from ns_domain pattern
    // (fallback for pairs without explicit sending domain records)
    if (domainList.length === 0 && serverPair.ns_domain) {
      // Just check the NS domain itself
      domainList.push(serverPair.ns_domain);
    }

    // Run full health check
    const verifier = new DNSVerifier();
    const report = await verifier.fullHealthCheck({
      server1IP: serverPair.s1_ip,
      server2IP: serverPair.s2_ip,
      nsDomain: serverPair.ns_domain,
      sendingDomains: domainList.filter((d) => d !== serverPair.ns_domain),
    });

    // Store report in server pair metadata
    await supabase
      .from('server_pairs')
      .update({
        health_status: report.overall === 'PASS' ? 'healthy' : report.overall === 'WARN' ? 'warning' : 'critical',
        mxtoolbox_errors: report.totalIssues,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json(report);
  } catch (error) {
    console.error('[Health] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
