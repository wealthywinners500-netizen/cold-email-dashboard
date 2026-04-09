import { createClient } from '@supabase/supabase-js';

interface Campaign {
  id: string;
  org_id: string;
  name: string;
  status: string;
  stats?: Record<string, unknown>;
}

interface EmailSendLog {
  id: string;
  campaign_id: string;
  status: string;
  sent_at: string;
}

interface TrackingEvent {
  id: string;
  campaign_id: string;
  event_type: string;
  timestamp: string;
}

interface SystemAlert {
  org_id: string;
  alert_type: string;
  severity: string;
  title: string;
  details: Record<string, unknown>;
  account_id?: string;
}

interface CampaignStats {
  sends_7d: number;
  bounces_7d: number;
  bounce_rate: number;
  opens_7d: number;
  open_rate: number;
  clicks_7d: number;
  click_rate: number;
  last_checked: string;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function getSevenDaysAgoISO(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function calculateStats(
  sends: number,
  bounces: number,
  opens: number,
  clicks: number
): CampaignStats {
  const bounceRate = sends > 0 ? (bounces / sends) * 100 : 0;
  const openRate = sends > 0 ? (opens / sends) * 100 : 0;
  const clickRate = sends > 0 ? (clicks / sends) * 100 : 0;

  return {
    sends_7d: sends,
    bounces_7d: bounces,
    bounce_rate: Math.round(bounceRate * 100) / 100,
    opens_7d: opens,
    open_rate: Math.round(openRate * 100) / 100,
    clicks_7d: clicks,
    click_rate: Math.round(clickRate * 100) / 100,
    last_checked: new Date().toISOString(),
  };
}

export async function handleCampaignPerformanceMonitor() {
  const supabase = getSupabase();
  const sevenDaysAgo = getSevenDaysAgoISO();

  try {
    // Fetch all campaigns with status = 'sending'
    const { data: campaigns, error: campaignsError } = await supabase
      .from('campaigns')
      .select('id, org_id, name, status, stats')
      .eq('status', 'sending');

    if (campaignsError) {
      throw new Error(
        `Failed to fetch campaigns: ${campaignsError.message}`
      );
    }

    if (!campaigns || campaigns.length === 0) {
      console.log('[campaign-performance-monitor] No active campaigns found');
      return;
    }

    console.log(
      `[campaign-performance-monitor] Processing ${campaigns.length} active campaigns`
    );

    const updates: Array<{
      id: string;
      stats: CampaignStats;
    }> = [];
    const alerts: SystemAlert[] = [];

    // Process each campaign
    for (const campaign of campaigns as Campaign[]) {
      // Fetch email send logs for last 7 days
      const { data: sendLogs, error: sendLogsError } = await supabase
        .from('email_send_log')
        .select('id, status, sent_at')
        .eq('campaign_id', campaign.id)
        .gte('sent_at', sevenDaysAgo);

      if (sendLogsError) {
        console.error(
          `[campaign-performance-monitor] Failed to fetch send logs for campaign ${campaign.id}: ${sendLogsError.message}`
        );
        continue;
      }

      // Fetch tracking events for last 7 days
      const { data: trackingEvents, error: trackingError } = await supabase
        .from('tracking_events')
        .select('id, event_type, timestamp')
        .eq('campaign_id', campaign.id)
        .gte('timestamp', sevenDaysAgo);

      if (trackingError) {
        console.error(
          `[campaign-performance-monitor] Failed to fetch tracking events for campaign ${campaign.id}: ${trackingError.message}`
        );
        continue;
      }

      // Calculate metrics
      const sendLogs7d = (sendLogs || []) as EmailSendLog[];
      const trackingEvents7d = (trackingEvents || []) as TrackingEvent[];

      const sends = sendLogs7d.length;
      const bounces = sendLogs7d.filter(
        (log) => log.status === 'bounced'
      ).length;
      const opens = trackingEvents7d.filter(
        (event) => event.event_type === 'open'
      ).length;
      const clicks = trackingEvents7d.filter(
        (event) => event.event_type === 'click'
      ).length;

      const stats = calculateStats(sends, bounces, opens, clicks);

      updates.push({
        id: campaign.id,
        stats,
      });

      // Check for high bounce rate (> 7%)
      if (stats.bounce_rate > 7) {
        alerts.push({
          org_id: campaign.org_id,
          alert_type: 'campaign_bounce_rate',
          severity: 'warning',
          title: `High bounce rate on campaign "${campaign.name}"`,
          details: {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            bounce_rate: stats.bounce_rate,
            bounces_7d: stats.bounces_7d,
            sends_7d: stats.sends_7d,
          },
        });
      }

      // Check for low open rate (< 5% but only if there are opens to avoid false positives)
      if (stats.open_rate < 5 && stats.opens_7d > 0) {
        alerts.push({
          org_id: campaign.org_id,
          alert_type: 'campaign_low_opens',
          severity: 'warning',
          title: `Low open rate on campaign "${campaign.name}"`,
          details: {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            open_rate: stats.open_rate,
            opens_7d: stats.opens_7d,
            sends_7d: stats.sends_7d,
          },
        });
      }
    }

    // Batch update campaigns with new stats
    if (updates.length > 0) {
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('campaigns')
          .update({ stats: update.stats })
          .eq('id', update.id);

        if (updateError) {
          console.error(
            `[campaign-performance-monitor] Failed to update campaign ${update.id}: ${updateError.message}`
          );
        }
      }

      console.log(
        `[campaign-performance-monitor] Updated ${updates.length} campaigns`
      );
    }

    // Batch insert alerts
    if (alerts.length > 0) {
      const { error: alertError } = await supabase
        .from('system_alerts')
        .insert(alerts);

      if (alertError) {
        console.error(
          `[campaign-performance-monitor] Failed to insert alerts: ${alertError.message}`
        );
      } else {
        console.log(
          `[campaign-performance-monitor] Created ${alerts.length} alerts`
        );
      }
    }

    console.log('[campaign-performance-monitor] Daily performance check completed');
  } catch (error) {
    console.error('[campaign-performance-monitor] Fatal error:', error);
    throw error;
  }
}
