import { createClient } from '@supabase/supabase-js';
import { getBoss } from './campaign-queue';
import type {
  CampaignSequence,
  LeadSequenceState,
  SequenceStep,
  LeadSequenceHistoryEvent,
  Campaign,
} from '../supabase/types';

// Lazy initialization pattern - never at module scope
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/**
 * Initialize sequence for all pending recipients in a campaign
 * Assigns variants, accounts, and queues first step
 */
export async function initializeSequence(
  campaignId: string,
  orgId: string
): Promise<number> {
  const supabase = getSupabase();

  // Get primary sequence
  const { data: sequences, error: seqError } = await supabase
    .from('campaign_sequences')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('sequence_type', 'primary')
    .single();

  if (seqError || !sequences) {
    throw new Error(
      `No primary sequence found for campaign ${campaignId}: ${seqError?.message}`
    );
  }

  const sequence = sequences as CampaignSequence;
  const steps = sequence.steps as SequenceStep[];
  const totalSteps = steps.length;

  // Get all pending recipients
  const { data: recipients, error: recipError } = await supabase
    .from('campaign_recipients')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending');

  if (recipError) {
    throw new Error(`Failed to fetch recipients: ${recipError.message}`);
  }

  // Get active email accounts for round-robin assignment
  const { data: accounts, error: accError } = await supabase
    .from('email_accounts')
    .select('id, sends_today, daily_send_limit')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (accError) {
    throw new Error(`Failed to fetch email accounts: ${accError.message}`);
  }

  // Filter accounts that haven't hit daily limit
  const activeAccounts = (accounts || []).filter(
    (a) => a.sends_today < a.daily_send_limit
  );

  if (activeAccounts.length === 0) {
    throw new Error('No active email accounts available');
  }

  // Get campaign to check sending schedule
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('sending_schedule')
    .eq('id', campaignId)
    .single();

  if (campError || !campaign) {
    throw new Error(`Failed to fetch campaign: ${campError?.message}`);
  }

  // Prepare state records
  const statesToInsert: LeadSequenceState[] = [];
  const variants = ['A', 'B', 'C', 'D'];
  let accountRoundRobinIndex = 0;

  for (const recipient of recipients || []) {
    const assignedVariant = variants[Math.floor(Math.random() * variants.length)];
    const assignedAccount =
      activeAccounts[accountRoundRobinIndex % activeAccounts.length];
    accountRoundRobinIndex++;

    // Calculate next_send_at for first step
    const firstStep = steps[0];
    const delayMs =
      (firstStep.delay_days || 0) * 86400000 +
      (firstStep.delay_hours || 0) * 3600000;
    let nextSendAt = new Date(Date.now() + delayMs);

    // Enforce business hours
    nextSendAt = enforceBusinessHours(
      nextSendAt,
      campaign.sending_schedule || {}
    );

    const state: LeadSequenceState = {
      id: crypto.randomUUID(),
      org_id: orgId,
      recipient_id: recipient.id,
      campaign_id: campaignId,
      sequence_id: sequence.id,
      current_step: 0,
      total_steps: totalSteps,
      status: 'active',
      next_send_at: nextSendAt.toISOString(),
      last_sent_at: null,
      assigned_variant: assignedVariant,
      assigned_account_id: assignedAccount.id,
      last_message_id: null,
      history: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    statesToInsert.push(state);
  }

  // Insert all states
  if (statesToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('lead_sequence_state')
      .insert(statesToInsert);

    if (insertError) {
      throw new Error(`Failed to insert sequence states: ${insertError.message}`);
    }

    // Queue first step for each state
    for (const state of statesToInsert) {
      await queueSequenceStep(
        state.id,
        state.recipient_id,
        state.sequence_id,
        0,
        campaignId,
        orgId,
        new Date(state.next_send_at!)
      );
    }
  }

  return statesToInsert.length;
}

/**
 * Advance lead to next step in sequence
 * Updates state, queues next step, or marks completed
 */
export async function advanceStep(stateId: string): Promise<void> {
  const supabase = getSupabase();

  // Fetch current state
  const { data: state, error: fetchError } = await supabase
    .from('lead_sequence_state')
    .select('*')
    .eq('id', stateId)
    .single();

  if (fetchError || !state) {
    return; // Silently fail if not found
  }

  const currentState = state as LeadSequenceState;

  // Skip if not active
  if (currentState.status !== 'active') {
    return;
  }

  const nextStep = currentState.current_step + 1;
  const now = new Date();

  // Add sent event to history
  const updatedHistory: LeadSequenceHistoryEvent[] = [
    ...(currentState.history || []),
    {
      event: 'sent',
      step: nextStep,
      at: now.toISOString(),
    },
  ];

  if (nextStep < currentState.total_steps) {
    // More steps remain - fetch sequence to get next step's delay
    const { data: sequence, error: seqError } = await supabase
      .from('campaign_sequences')
      .select('steps, sending_schedule')
      .eq('id', currentState.sequence_id)
      .single();

    if (seqError || !sequence) {
      throw new Error(`Failed to fetch sequence: ${seqError?.message}`);
    }

    const steps = sequence.steps as SequenceStep[];
    const nextStepData = steps[nextStep];

    if (!nextStepData) {
      throw new Error(`Step ${nextStep} not found in sequence`);
    }

    // Calculate next send time
    const delayMs =
      (nextStepData.delay_days || 0) * 86400000 +
      (nextStepData.delay_hours || 0) * 3600000;
    let nextSendAt = new Date(Date.now() + delayMs);

    // Get campaign for sending schedule
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('sending_schedule')
      .eq('id', currentState.campaign_id)
      .single();

    // Enforce business hours
    nextSendAt = enforceBusinessHours(
      nextSendAt,
      campaign?.sending_schedule || {}
    );

    // Update state with next step
    const { error: updateError } = await supabase
      .from('lead_sequence_state')
      .update({
        current_step: nextStep,
        next_send_at: nextSendAt.toISOString(),
        last_sent_at: now.toISOString(),
        history: updatedHistory,
        updated_at: now.toISOString(),
      })
      .eq('id', stateId);

    if (updateError) {
      throw new Error(`Failed to update state: ${updateError.message}`);
    }

    // Queue next step
    await queueSequenceStep(
      stateId,
      currentState.recipient_id,
      currentState.sequence_id,
      nextStep,
      currentState.campaign_id,
      currentState.org_id,
      nextSendAt
    );
  } else {
    // Sequence complete
    const { error: updateError } = await supabase
      .from('lead_sequence_state')
      .update({
        status: 'completed',
        last_sent_at: now.toISOString(),
        history: updatedHistory,
        updated_at: now.toISOString(),
      })
      .eq('id', stateId);

    if (updateError) {
      throw new Error(`Failed to mark sequence completed: ${updateError.message}`);
    }
  }
}

/**
 * Handle reply from recipient - trigger reply-based subsequences
 */
export async function handleReply(
  recipientId: string,
  campaignId: string,
  classification: string
): Promise<void> {
  const supabase = getSupabase();

  // Find active state for this recipient in campaign
  const { data: activeState, error: stateError } = await supabase
    .from('lead_sequence_state')
    .select('*')
    .eq('recipient_id', recipientId)
    .eq('campaign_id', campaignId)
    .eq('status', 'active')
    .single();

  if (stateError || !activeState) {
    return; // No active state
  }

  const state = activeState as LeadSequenceState;
  const now = new Date();

  // Update active state status to replied
  const updatedHistory: LeadSequenceHistoryEvent[] = [
    ...(state.history || []),
    {
      event: 'replied',
      at: now.toISOString(),
      classification,
    },
  ];

  const { error: updateError } = await supabase
    .from('lead_sequence_state')
    .update({
      status: 'replied',
      history: updatedHistory,
      updated_at: now.toISOString(),
    })
    .eq('id', state.id);

  if (updateError) {
    throw new Error(`Failed to update state to replied: ${updateError.message}`);
  }

  // Find matching reply trigger subsequences
  const { data: subsequences, error: subError } = await supabase
    .from('campaign_sequences')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('trigger_event', 'reply_classified')
    .eq('status', 'active');

  if (subError) {
    throw new Error(`Failed to fetch subsequences: ${subError.message}`);
  }

  // Find highest priority match
  let matchedSequence: CampaignSequence | null = null;
  let highestPriority = -1;

  for (const seq of subsequences || []) {
    const condition = seq.trigger_condition as Record<string, unknown> | null;
    if (
      condition &&
      condition.classification === classification &&
      seq.trigger_priority > highestPriority
    ) {
      matchedSequence = seq as CampaignSequence;
      highestPriority = seq.trigger_priority;
    }
  }

  if (matchedSequence) {
    const { data: newState, error: insertError } = await supabase
      .from('lead_sequence_state')
      .insert([
        {
          id: crypto.randomUUID(),
          org_id: state.org_id,
          recipient_id: recipientId,
          campaign_id: campaignId,
          sequence_id: matchedSequence.id,
          current_step: 0,
          total_steps: (matchedSequence.steps as SequenceStep[]).length,
          status: 'active',
          next_send_at: new Date().toISOString(),
          assigned_variant: state.assigned_variant,
          assigned_account_id: state.assigned_account_id,
          history: [
            {
              event: 'moved',
              from_sequence: state.sequence_id,
              to_sequence: matchedSequence.id,
              at: now.toISOString(),
            },
          ],
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
      ])
      .select()
      .single();

    if (insertError) {
      throw new Error(
        `Failed to create reply subsequence state: ${insertError.message}`
      );
    }

    if (newState) {
      const newStateTyped = newState as LeadSequenceState;
      await queueSequenceStep(
        newStateTyped.id,
        recipientId,
        matchedSequence.id,
        0,
        campaignId,
        state.org_id,
        new Date(newStateTyped.next_send_at!)
      );
    }
  }
}

/**
 * Handle bounce - mark all active sequences as bounced
 */
export async function handleBounce(recipientId: string): Promise<void> {
  const supabase = getSupabase();

  const now = new Date();
  const bounceEvent: LeadSequenceHistoryEvent = {
    event: 'bounced',
    at: now.toISOString(),
  };

  // Find all active states for recipient
  const { data: states, error: fetchError } = await supabase
    .from('lead_sequence_state')
    .select('*')
    .eq('recipient_id', recipientId)
    .eq('status', 'active');

  if (fetchError) {
    throw new Error(`Failed to fetch states: ${fetchError.message}`);
  }

  // Update each to bounced status
  for (const state of states || []) {
    const updatedHistory: LeadSequenceHistoryEvent[] = [
      ...(state.history || []),
      bounceEvent,
    ];

    const { error: updateError } = await supabase
      .from('lead_sequence_state')
      .update({
        status: 'bounced',
        history: updatedHistory,
        updated_at: now.toISOString(),
      })
      .eq('id', state.id);

    if (updateError) {
      throw new Error(`Failed to update bounced state: ${updateError.message}`);
    }
  }
}

/**
 * Handle opt-out - mark all sequences for this recipient as opted out
 */
export async function handleOptOut(
  recipientId: string,
  orgId: string
): Promise<void> {
  const supabase = getSupabase();

  const now = new Date();
  const optOutEvent: LeadSequenceHistoryEvent = {
    event: 'opted_out',
    at: now.toISOString(),
  };

  // Find all states for recipient in org
  const { data: states, error: fetchError } = await supabase
    .from('lead_sequence_state')
    .select('*')
    .eq('recipient_id', recipientId)
    .eq('org_id', orgId);

  if (fetchError) {
    throw new Error(`Failed to fetch states: ${fetchError.message}`);
  }

  // Update all to opted_out status
  for (const state of states || []) {
    const updatedHistory: LeadSequenceHistoryEvent[] = [
      ...(state.history || []),
      optOutEvent,
    ];

    const { error: updateError } = await supabase
      .from('lead_sequence_state')
      .update({
        status: 'opted_out',
        history: updatedHistory,
        updated_at: now.toISOString(),
      })
      .eq('id', state.id);

    if (updateError) {
      throw new Error(`Failed to update opted_out state: ${updateError.message}`);
    }
  }
}

/**
 * Check for completed sequences with no reply and trigger no-reply subsequences
 */
export async function checkNoReplyTriggers(orgId: string): Promise<number> {
  const supabase = getSupabase();

  const now = new Date();
  let movedCount = 0;

  // Find all completed states without reply
  const { data: completedStates, error: fetchError } = await supabase
    .from('lead_sequence_state')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'completed');

  if (fetchError) {
    throw new Error(`Failed to fetch completed states: ${fetchError.message}`);
  }

  for (const state of completedStates || []) {
    const typedState = state as LeadSequenceState;

    // Check if has replied event
    const hasReplied = (typedState.history || []).some(
      (e) => e.event === 'replied'
    );

    if (hasReplied) continue;

    // Find no_reply trigger subsequences for this campaign
    const { data: noReplySeqs, error: subError } = await supabase
      .from('campaign_sequences')
      .select('*')
      .eq('campaign_id', typedState.campaign_id)
      .eq('trigger_event', 'no_reply')
      .eq('status', 'active');

    if (subError) {
      throw new Error(`Failed to fetch no_reply subsequences: ${subError.message}`);
    }

    for (const subsequence of noReplySeqs || []) {
      const condition = subsequence.trigger_condition as Record<
        string,
        unknown
      > | null;
      const requiredDaysNoReply = (condition?.days_no_reply as number) || 0;

      // Check elapsed days since last send
      const lastSentAt = typedState.last_sent_at
        ? new Date(typedState.last_sent_at)
        : new Date(typedState.created_at);
      const elapsedDays =
        (now.getTime() - lastSentAt.getTime()) / (1000 * 60 * 60 * 24);

      if (elapsedDays >= requiredDaysNoReply) {
        // Create new state in subsequence
        const { data: newState, error: insertError } = await supabase
          .from('lead_sequence_state')
          .insert([
            {
              id: crypto.randomUUID(),
              org_id: typedState.org_id,
              recipient_id: typedState.recipient_id,
              campaign_id: typedState.campaign_id,
              sequence_id: subsequence.id,
              current_step: 0,
              total_steps: (subsequence.steps as SequenceStep[]).length,
              status: 'active',
              next_send_at: now.toISOString(),
              assigned_variant: typedState.assigned_variant,
              assigned_account_id: typedState.assigned_account_id,
              history: [
                {
                  event: 'moved',
                  from_sequence: typedState.sequence_id,
                  to_sequence: subsequence.id,
                  at: now.toISOString(),
                },
              ],
              created_at: now.toISOString(),
              updated_at: now.toISOString(),
            },
          ])
          .select()
          .single();

        if (insertError) {
          throw new Error(
            `Failed to create no_reply subsequence state: ${insertError.message}`
          );
        }

        if (newState) {
          const newStateTyped = newState as LeadSequenceState;
          await queueSequenceStep(
            newStateTyped.id,
            typedState.recipient_id,
            subsequence.id,
            0,
            typedState.campaign_id,
            typedState.org_id,
            new Date(newStateTyped.next_send_at!)
          );
        }

        // Update old state to moved_to_subsequence
        const oldHistory: LeadSequenceHistoryEvent[] = [
          ...(typedState.history || []),
          {
            event: 'moved',
            from_sequence: typedState.sequence_id,
            to_sequence: subsequence.id,
            at: now.toISOString(),
          },
        ];

        const { error: updateError } = await supabase
          .from('lead_sequence_state')
          .update({
            status: 'moved_to_subsequence',
            history: oldHistory,
            updated_at: now.toISOString(),
          })
          .eq('id', typedState.id);

        if (updateError) {
          throw new Error(
            `Failed to update moved state: ${updateError.message}`
          );
        }

        movedCount++;
        break; // Only move to first matching subsequence
      }
    }
  }

  return movedCount;
}

/**
 * Queue a sequence step for processing
 */
export async function queueSequenceStep(
  stateId: string,
  recipientId: string,
  sequenceId: string,
  stepNumber: number,
  campaignId: string,
  orgId: string,
  sendAt: Date
): Promise<void> {
  const boss = getBoss();
  const now = new Date();
  const secondsUntilSend = Math.max(
    0,
    Math.floor((sendAt.getTime() - now.getTime()) / 1000)
  );

  await boss.send(
    'process-sequence-step',
    {
      stateId,
      recipientId,
      sequenceId,
      stepNumber,
      campaignId,
      orgId,
    },
    {
      startAfter: secondsUntilSend,
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    }
  );
}

/**
 * Enforce business hours on a send time
 * Respects weekend exclusion and send_between_hours
 */
export function enforceBusinessHours(
  sendAt: Date,
  schedule: Record<string, unknown>
): Date {
  const sendBetweenHours = schedule.send_between_hours as [number, number] | undefined;
  const days = schedule.days as string[] | undefined;
  const timezone = schedule.timezone as string | undefined;

  if (!sendBetweenHours || !days) {
    return sendAt; // No schedule, use as-is
  }

  const [startHour, endHour] = sendBetweenHours;
  let checkDate = new Date(sendAt);

  // Simple UTC offset calculation (no external timezone lib)
  // For accurate timezone handling, consider using a library in production
  const tzOffsetHours = getTimezoneOffset(timezone || 'UTC');
  const offsetMs = tzOffsetHours * 3600000;
  const localDate = new Date(checkDate.getTime() + offsetMs);

  // Check day of week (0=Sun, 1=Mon, ..., 6=Sat)
  let dayOfWeek = localDate.getUTCDay();
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const targetDayName = dayNames[dayOfWeek];

  // If not in send_days, push to next valid day
  if (!days.includes(targetDayName)) {
    let daysToAdd = 1;
    for (let i = 0; i < 7; i++) {
      dayOfWeek = (dayOfWeek + 1) % 7;
      if (days.includes(dayNames[dayOfWeek])) {
        daysToAdd = i + 1;
        break;
      }
    }
    checkDate.setUTCDate(checkDate.getUTCDate() + daysToAdd);
    checkDate.setUTCHours(startHour, 0, 0, 0);
    return checkDate;
  }

  // Check hour is within send window
  const currentHour = localDate.getUTCHours();
  if (currentHour < startHour) {
    // Before send window - set to start hour
    checkDate.setUTCHours(startHour, 0, 0, 0);
    return checkDate;
  } else if (currentHour >= endHour) {
    // After send window - push to next valid day at start hour
    checkDate.setUTCDate(checkDate.getUTCDate() + 1);
    checkDate.setUTCHours(startHour, 0, 0, 0);
    return enforceBusinessHours(checkDate, schedule); // Recursively check next day
  }

  return checkDate;
}

/**
 * Simple timezone offset lookup (no external library)
 * For production, use proper timezone library like date-fns-tz or moment-tz
 */
function getTimezoneOffset(timezone: string): number {
  const offsets: Record<string, number> = {
    'UTC': 0,
    'EST': -5,
    'CST': -6,
    'MST': -7,
    'PST': -8,
    'EDT': -4,
    'CDT': -5,
    'MDT': -6,
    'PDT': -7,
    'GMT': 0,
    'BST': 1,
    'CET': 1,
    'CEST': 2,
  };

  return offsets[timezone.toUpperCase()] ?? 0;
}
