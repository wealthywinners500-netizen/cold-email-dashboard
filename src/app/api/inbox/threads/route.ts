import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  parseTab,
  postgrestHintsFor,
  matchesTab,
  ThreadLike,
} from '@/lib/inbox/tab-routing';

export const dynamic = 'force-dynamic';

async function getInternalOrgId(): Promise<string> {
  const { orgId } = await auth();
  if (!orgId) throw new Error('No organization selected');

  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .single();

  if (error || !data) throw new Error('Organization not found');
  return data.id;
}

async function getKnownSenders(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  orgId: string
): Promise<Set<string>> {
  const known = new Set<string>();

  // Org's own email accounts
  const { data: accts } = await supabase
    .from('email_accounts')
    .select('email')
    .eq('org_id', orgId);
  for (const a of accts || []) {
    if (a.email) known.add(String(a.email).toLowerCase());
  }

  // Senders we've corresponded with before. lead_contacts is empty per memory
  // (0 rows as of 2026-04-29) but include defensively if it grows.
  const { data: contacts } = await supabase
    .from('lead_contacts')
    .select('email')
    .eq('org_id', orgId);
  for (const c of contacts || []) {
    if (c?.email) known.add(String(c.email).toLowerCase());
  }

  return known;
}

export async function GET(request: NextRequest) {
  try {
    const orgId = await getInternalOrgId();
    const supabase = await createAdminClient();
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const perPage = Math.min(200, Math.max(1, parseInt(searchParams.get('per_page') || '50')));
    const tab = parseTab(searchParams.get('tab'));
    const campaignId = searchParams.get('campaign_id');
    const unread = searchParams.get('unread');
    const search = searchParams.get('search');
    const accountId = searchParams.get('account_id');
    const fromDate = searchParams.get('from_date'); // ISO date or datetime
    const toDate = searchParams.get('to_date');

    const hints = postgrestHintsFor(tab);

    let query = supabase
      .from('inbox_threads')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .eq('is_archived', false)
      .order('latest_message_date', { ascending: false });

    if (hints.subjectIlike) query = query.ilike('subject', hints.subjectIlike);
    if (hints.subjectNotIlike) query = query.not('subject', 'ilike', hints.subjectNotIlike);
    if (hints.classificationIn) query = query.in('latest_classification', hints.classificationIn);
    if (hints.classificationEq) query = query.eq('latest_classification', hints.classificationEq);

    if (campaignId) query = query.eq('campaign_id', campaignId);
    if (unread === 'true') query = query.eq('has_unread', true);
    if (accountId) query = query.contains('account_emails', [accountId]);
    if (fromDate) query = query.gte('latest_message_date', fromDate);
    if (toDate) query = query.lte('latest_message_date', toDate);

    query = query.range((page - 1) * perPage, page * perPage - 1);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let filteredData = data || [];

    // Search: full-text on messages, then narrow threads.
    if (search && filteredData.length > 0) {
      const { data: searchResults } = await supabase
        .from('inbox_messages')
        .select('thread_id')
        .eq('org_id', orgId)
        .textSearch('search_vector', search)
        .limit(500);

      if (searchResults) {
        const matchingThreadIds = new Set(searchResults.map((r: { thread_id: number | null }) => r.thread_id));
        filteredData = filteredData.filter((t: { id: number }) => matchingThreadIds.has(t.id));
      }
    }

    // Tighten with the JS-side predicate so the spam known-sender check and the
    // self-test warm-up signal land on the right tab. PostgREST hints are the
    // cheap pass; this is the exact match.
    if (tab === 'all' || tab === 'spam' || tab === 'warm-up') {
      const knownSenders = await getKnownSenders(supabase, orgId);
      filteredData = filteredData.filter((t: ThreadLike & { id: number }) =>
        matchesTab(tab, t, knownSenders)
      );
    }

    return NextResponse.json({
      threads: filteredData,
      pagination: {
        page,
        per_page: perPage,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / perPage),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
