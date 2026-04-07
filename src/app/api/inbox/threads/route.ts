import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';

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

export async function GET(request: NextRequest) {
  try {
    const orgId = await getInternalOrgId();
    const supabase = await createAdminClient();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const perPage = parseInt(searchParams.get('per_page') || '50');
    const classification = searchParams.get('classification');
    const campaignId = searchParams.get('campaign_id');
    const unread = searchParams.get('unread');
    const search = searchParams.get('search');
    const accountId = searchParams.get('account_id');

    let query = supabase
      .from('inbox_threads')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .eq('is_archived', false)
      .order('latest_message_date', { ascending: false });

    if (classification) {
      query = query.eq('latest_classification', classification);
    }
    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }
    if (unread === 'true') {
      query = query.eq('has_unread', true);
    }
    if (accountId) {
      query = query.contains('account_emails', [accountId]);
    }

    query = query.range((page - 1) * perPage, page * perPage - 1);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If search term provided, do full-text search on messages and filter threads
    let filteredData = data;
    if (search && data) {
      const { data: searchResults } = await supabase
        .from('inbox_messages')
        .select('thread_id')
        .eq('org_id', orgId)
        .textSearch('search_vector', search)
        .limit(200);

      if (searchResults) {
        const matchingThreadIds = new Set(searchResults.map((r: any) => r.thread_id));
        filteredData = data.filter((t: any) => matchingThreadIds.has(t.id));
      }
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
