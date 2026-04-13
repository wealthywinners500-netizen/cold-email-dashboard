// ============================================
// B15-5: GET /api/provisioning/[jobId]/csv
// Download Snov.io CSV for a completed provisioning job
// ============================================

import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { generateSnovioCSV } from '@/lib/provisioning/csv-generator';
import type { ProvisioningJobRow } from '@/lib/provisioning/types';
import { decrypt } from '@/lib/provisioning/encryption';

export const dynamic = 'force-dynamic';

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
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createAdminClient();

    // Load job with org_id isolation
    const { data: job, error: jobError } = await supabase
      .from('provisioning_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const provJob = job as ProvisioningJobRow;

    // Check if we have a pre-generated CSV in config
    if (provJob.config?.snovio_csv) {
      const csv = provJob.config.snovio_csv as string;
      const filename = `pair-${provJob.ns_domain}-snovio.csv`;

      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // If no pre-generated CSV, build from email accounts in DB
    if (!provJob.server_pair_id) {
      return NextResponse.json(
        { error: 'Job has no associated server pair — CSV not available' },
        { status: 400 }
      );
    }

    // Load server pair
    const { data: serverPair } = await supabase
      .from('server_pairs')
      .select('*')
      .eq('id', provJob.server_pair_id)
      .eq('org_id', orgId)
      .single();

    if (!serverPair) {
      return NextResponse.json(
        { error: 'Server pair not found' },
        { status: 404 }
      );
    }

    // Load email accounts
    const { data: accounts } = await supabase
      .from('email_accounts')
      .select('email, smtp_host')
      .eq('server_pair_id', serverPair.id)
      .eq('org_id', orgId);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json(
        { error: 'No email accounts found for this job' },
        { status: 400 }
      );
    }

    // Read real password from ssh_credentials (encrypted)
    const { data: sshCreds } = await supabase
      .from('ssh_credentials')
      .select('password_encrypted')
      .eq('provisioning_job_id', jobId)
      .limit(1)
      .maybeSingle();

    let mailPassword = 'changeme123'; // fallback only
    if (sshCreds?.password_encrypted) {
      try {
        mailPassword = decrypt(sshCreds.password_encrypted);
      } catch (err) {
        console.error('[CSV] Failed to decrypt ssh_credentials password:', err);
      }
    }

    const mailAccounts = accounts.map((acc) => {
      const isServer1 =
        acc.smtp_host === serverPair.s1_ip ||
        acc.smtp_host?.includes('mail1');
      return {
        email: acc.email,
        password: mailPassword,
        server: (isServer1 ? 'server1' : 'server2') as 'server1' | 'server2',
      };
    });

    const csv = generateSnovioCSV({
      serverPair: {
        server1IP: serverPair.s1_ip,
        server2IP: serverPair.s2_ip,
        nsDomain: provJob.ns_domain,
      },
      sendingDomains: provJob.sending_domains,
      mailAccounts,
    });

    const filename = `pair-${provJob.ns_domain}-snovio.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[CSV] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
