export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          clerk_org_id: string;
          name: string;
          plan_tier: string;
          stripe_customer_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          clerk_org_id: string;
          name: string;
          plan_tier?: string;
          stripe_customer_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          clerk_org_id?: string;
          name?: string;
          plan_tier?: string;
          stripe_customer_id?: string | null;
          created_at?: string;
        };
      };
      server_pairs: {
        Row: {
          id: string;
          org_id: string;
          pair_number: number;
          ns_domain: string;
          s1_ip: string;
          s1_hostname: string;
          s2_ip: string;
          s2_hostname: string;
          status: string;
          mxtoolbox_errors: number;
          warmup_day: number;
          total_accounts: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          pair_number: number;
          ns_domain: string;
          s1_ip: string;
          s1_hostname: string;
          s2_ip: string;
          s2_hostname: string;
          status: string;
          mxtoolbox_errors?: number;
          warmup_day?: number;
          total_accounts?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          pair_number?: number;
          ns_domain?: string;
          s1_ip?: string;
          s1_hostname?: string;
          s2_ip?: string;
          s2_hostname?: string;
          status?: string;
          mxtoolbox_errors?: number;
          warmup_day?: number;
          total_accounts?: number;
          created_at?: string;
        };
      };
      sending_domains: {
        Row: {
          id: string;
          pair_id: string;
          domain: string;
          spf_status: string;
          dkim_status: string;
          dmarc_status: string;
          blacklist_status: string;
          last_checked: string | null;
        };
        Insert: {
          id?: string;
          pair_id: string;
          domain: string;
          spf_status: string;
          dkim_status: string;
          dmarc_status: string;
          blacklist_status: string;
          last_checked?: string | null;
        };
        Update: {
          id?: string;
          pair_id?: string;
          domain?: string;
          spf_status?: string;
          dkim_status?: string;
          dmarc_status?: string;
          blacklist_status?: string;
          last_checked?: string | null;
        };
      };
      campaigns: {
        Row: {
          id: string;
          org_id: string;
          snovio_id: string | null;
          name: string;
          region: string;
          store_chain: string;
          recipients: number;
          open_rate: number | null;
          reply_rate: number | null;
          bounce_rate: number | null;
          status: string;
          subject_lines: string[];
          body_html: string | null;
          body_text: string | null;
          sending_schedule: Record<string, unknown> | null;
          total_sent: number;
          total_opened: number;
          total_clicked: number;
          total_replied: number;
          total_bounced: number;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          snovio_id?: string | null;
          name: string;
          region: string;
          store_chain: string;
          recipients?: number;
          open_rate?: number | null;
          reply_rate?: number | null;
          bounce_rate?: number | null;
          status?: string;
          subject_lines?: string[];
          body_html?: string | null;
          body_text?: string | null;
          sending_schedule?: Record<string, unknown> | null;
          total_sent?: number;
          total_opened?: number;
          total_clicked?: number;
          total_replied?: number;
          total_bounced?: number;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          snovio_id?: string | null;
          name?: string;
          region?: string;
          store_chain?: string;
          recipients?: number;
          open_rate?: number | null;
          reply_rate?: number | null;
          bounce_rate?: number | null;
          status?: string;
          subject_lines?: string[];
          body_html?: string | null;
          body_text?: string | null;
          sending_schedule?: Record<string, unknown> | null;
          total_sent?: number;
          total_opened?: number;
          total_clicked?: number;
          total_replied?: number;
          total_bounced?: number;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
      };
      leads: {
        Row: {
          id: string;
          org_id: string;
          source: string;
          city: string;
          state: string;
          total_scraped: number;
          verified_count: number;
          cost_per_lead: number | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          source: string;
          city: string;
          state: string;
          total_scraped: number;
          verified_count: number;
          cost_per_lead?: number | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          source?: string;
          city?: string;
          state?: string;
          total_scraped?: number;
          verified_count?: number;
          cost_per_lead?: number | null;
          status?: string;
          created_at?: string;
        };
      };
      follow_ups: {
        Row: {
          id: string;
          org_id: string;
          campaign_id: string;
          thread_id: string;
          classification: string;
          template_assigned: string | null;
          action_needed: string | null;
          last_reply_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          campaign_id: string;
          thread_id: string;
          classification: string;
          template_assigned?: string | null;
          action_needed?: string | null;
          last_reply_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          campaign_id?: string;
          thread_id?: string;
          classification?: string;
          template_assigned?: string | null;
          action_needed?: string | null;
          last_reply_date?: string | null;
          created_at?: string;
        };
      };
      sms_workflows: {
        Row: {
          id: string;
          org_id: string;
          stage: string;
          name: string;
          message_type: string;
          message_count: number;
          description: string | null;
          tag_applied: string | null;
          region: string;
          store_chains: string[];
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          stage: string;
          name: string;
          message_type?: string;
          message_count?: number;
          description?: string | null;
          tag_applied?: string | null;
          region?: string;
          store_chains?: string[];
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          stage?: string;
          name?: string;
          message_type?: string;
          message_count?: number;
          description?: string | null;
          tag_applied?: string | null;
          region?: string;
          store_chains?: string[];
          status?: string;
          created_at?: string;
        };
      };
      campaign_sequences: {
        Row: {
          id: string;
          org_id: string;
          campaign_id: string;
          name: string;
          sequence_type: string;
          sort_order: number;
          trigger_event: string | null;
          trigger_condition: Record<string, unknown> | null;
          trigger_priority: number;
          persona: string | null;
          steps: Record<string, unknown>[];
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          campaign_id: string;
          name: string;
          sequence_type?: string;
          sort_order?: number;
          trigger_event?: string | null;
          trigger_condition?: Record<string, unknown> | null;
          trigger_priority?: number;
          persona?: string | null;
          steps?: Record<string, unknown>[];
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          campaign_id?: string;
          name?: string;
          sequence_type?: string;
          sort_order?: number;
          trigger_event?: string | null;
          trigger_condition?: Record<string, unknown> | null;
          trigger_priority?: number;
          persona?: string | null;
          steps?: Record<string, unknown>[];
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      lead_sequence_state: {
        Row: {
          id: string;
          org_id: string;
          recipient_id: string;
          campaign_id: string;
          sequence_id: string;
          current_step: number;
          total_steps: number;
          status: string;
          next_send_at: string | null;
          last_sent_at: string | null;
          assigned_variant: string | null;
          assigned_account_id: string | null;
          last_message_id: string | null;
          history: Record<string, unknown>[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          recipient_id: string;
          campaign_id: string;
          sequence_id: string;
          current_step?: number;
          total_steps: number;
          status?: string;
          next_send_at?: string | null;
          last_sent_at?: string | null;
          assigned_variant?: string | null;
          assigned_account_id?: string | null;
          last_message_id?: string | null;
          history?: Record<string, unknown>[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          recipient_id?: string;
          campaign_id?: string;
          sequence_id?: string;
          current_step?: number;
          total_steps?: number;
          status?: string;
          next_send_at?: string | null;
          last_sent_at?: string | null;
          assigned_variant?: string | null;
          assigned_account_id?: string | null;
          last_message_id?: string | null;
          history?: Record<string, unknown>[];
          created_at?: string;
          updated_at?: string;
        };
      };
      email_accounts: {
        Row: {
          id: string;
          org_id: string;
          email: string;
          display_name: string | null;
          smtp_host: string;
          smtp_port: number;
          smtp_secure: boolean;
          smtp_user: string;
          smtp_pass: string;
          imap_host: string | null;
          imap_port: number;
          imap_secure: boolean;
          server_pair_id: string | null;
          daily_send_limit: number;
          sends_today: number;
          warmup_day: number;
          status: string;
          last_error: string | null;
          last_sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          email: string;
          display_name?: string | null;
          smtp_host: string;
          smtp_port?: number;
          smtp_secure?: boolean;
          smtp_user: string;
          smtp_pass: string;
          imap_host?: string | null;
          imap_port?: number;
          imap_secure?: boolean;
          server_pair_id?: string | null;
          daily_send_limit?: number;
          sends_today?: number;
          warmup_day?: number;
          status?: string;
          last_error?: string | null;
          last_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          email?: string;
          display_name?: string | null;
          smtp_host?: string;
          smtp_port?: number;
          smtp_secure?: boolean;
          smtp_user?: string;
          smtp_pass?: string;
          imap_host?: string | null;
          imap_port?: number;
          imap_secure?: boolean;
          server_pair_id?: string | null;
          daily_send_limit?: number;
          sends_today?: number;
          warmup_day?: number;
          status?: string;
          last_error?: string | null;
          last_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      campaign_recipients: {
        Row: {
          id: string;
          org_id: string;
          campaign_id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          company_name: string | null;
          custom_fields: Record<string, unknown>;
          assigned_account_id: string | null;
          status: string;
          sent_at: string | null;
          opened_at: string | null;
          clicked_at: string | null;
          replied_at: string | null;
          bounced_at: string | null;
          bounce_type: string | null;
          message_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          campaign_id: string;
          email: string;
          first_name?: string | null;
          last_name?: string | null;
          company_name?: string | null;
          custom_fields?: Record<string, unknown>;
          assigned_account_id?: string | null;
          status?: string;
          sent_at?: string | null;
          opened_at?: string | null;
          clicked_at?: string | null;
          replied_at?: string | null;
          bounced_at?: string | null;
          bounce_type?: string | null;
          message_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          campaign_id?: string;
          email?: string;
          first_name?: string | null;
          last_name?: string | null;
          company_name?: string | null;
          custom_fields?: Record<string, unknown>;
          assigned_account_id?: string | null;
          status?: string;
          sent_at?: string | null;
          opened_at?: string | null;
          clicked_at?: string | null;
          replied_at?: string | null;
          bounced_at?: string | null;
          bounce_type?: string | null;
          message_id?: string | null;
          created_at?: string;
        };
      };
      email_send_log: {
        Row: {
          id: string;
          org_id: string;
          campaign_id: string | null;
          recipient_id: string | null;
          account_id: string | null;
          from_email: string;
          from_name: string | null;
          to_email: string;
          subject: string;
          body_html: string | null;
          body_text: string | null;
          message_id: string | null;
          smtp_response: string | null;
          status: string;
          error_message: string | null;
          retry_count: number;
          tracking_id: string | null;
          sent_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          campaign_id?: string | null;
          recipient_id?: string | null;
          account_id?: string | null;
          from_email: string;
          from_name?: string | null;
          to_email: string;
          subject: string;
          body_html?: string | null;
          body_text?: string | null;
          message_id?: string | null;
          smtp_response?: string | null;
          status?: string;
          error_message?: string | null;
          retry_count?: number;
          tracking_id?: string | null;
          sent_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          campaign_id?: string | null;
          recipient_id?: string | null;
          account_id?: string | null;
          from_email?: string;
          from_name?: string | null;
          to_email?: string;
          subject?: string;
          body_html?: string | null;
          body_text?: string | null;
          message_id?: string | null;
          smtp_response?: string | null;
          status?: string;
          error_message?: string | null;
          retry_count?: number;
          tracking_id?: string | null;
          sent_at?: string | null;
          created_at?: string;
        };
      };
      inbox_messages: {
        Row: {
          id: number;
          org_id: string;
          account_id: string;
          message_id: string | null;
          in_reply_to: string | null;
          references_header: string | null;
          thread_id: number | null;
          parent_id: number | null;
          direction: string;
          from_email: string;
          from_name: string | null;
          to_emails: string[];
          cc_emails: string[];
          subject: string | null;
          body_html: string | null;
          body_text: string | null;
          body_preview: string | null;
          reply_only_text: string | null;
          classification: string | null;
          classification_confidence: number | null;
          campaign_id: string | null;
          recipient_id: string | null;
          sequence_step: number | null;
          opened_at: string | null;
          clicked_at: string | null;
          imap_uid: number | null;
          imap_modseq: number | null;
          mailbox: string;
          is_read: boolean;
          is_starred: boolean;
          is_archived: boolean;
          is_deleted: boolean;
          has_attachments: boolean;
          attachment_count: number;
          received_date: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          org_id: string;
          account_id: string;
          message_id?: string | null;
          in_reply_to?: string | null;
          references_header?: string | null;
          thread_id?: number | null;
          parent_id?: number | null;
          direction: string;
          from_email: string;
          from_name?: string | null;
          to_emails?: string[];
          cc_emails?: string[];
          subject?: string | null;
          body_html?: string | null;
          body_text?: string | null;
          body_preview?: string | null;
          reply_only_text?: string | null;
          classification?: string | null;
          classification_confidence?: number | null;
          campaign_id?: string | null;
          recipient_id?: string | null;
          sequence_step?: number | null;
          opened_at?: string | null;
          clicked_at?: string | null;
          imap_uid?: number | null;
          imap_modseq?: number | null;
          mailbox?: string;
          is_read?: boolean;
          is_starred?: boolean;
          is_archived?: boolean;
          is_deleted?: boolean;
          has_attachments?: boolean;
          attachment_count?: number;
          received_date: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          org_id?: string;
          account_id?: string;
          message_id?: string | null;
          in_reply_to?: string | null;
          references_header?: string | null;
          thread_id?: number | null;
          parent_id?: number | null;
          direction?: string;
          from_email?: string;
          from_name?: string | null;
          to_emails?: string[];
          cc_emails?: string[];
          subject?: string | null;
          body_html?: string | null;
          body_text?: string | null;
          body_preview?: string | null;
          reply_only_text?: string | null;
          classification?: string | null;
          classification_confidence?: number | null;
          campaign_id?: string | null;
          recipient_id?: string | null;
          sequence_step?: number | null;
          opened_at?: string | null;
          clicked_at?: string | null;
          imap_uid?: number | null;
          imap_modseq?: number | null;
          mailbox?: string;
          is_read?: boolean;
          is_starred?: boolean;
          is_archived?: boolean;
          is_deleted?: boolean;
          has_attachments?: boolean;
          attachment_count?: number;
          received_date?: string;
          created_at?: string;
        };
      };
      inbox_threads: {
        Row: {
          id: number;
          org_id: string;
          subject: string | null;
          snippet: string | null;
          message_count: number;
          participants: string[];
          account_emails: string[];
          has_unread: boolean;
          is_starred: boolean;
          is_archived: boolean;
          latest_classification: string | null;
          campaign_id: string | null;
          campaign_name: string | null;
          latest_message_date: string;
          earliest_message_date: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          org_id: string;
          subject?: string | null;
          snippet?: string | null;
          message_count?: number;
          participants?: string[];
          account_emails?: string[];
          has_unread?: boolean;
          is_starred?: boolean;
          is_archived?: boolean;
          latest_classification?: string | null;
          campaign_id?: string | null;
          campaign_name?: string | null;
          latest_message_date: string;
          earliest_message_date: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          org_id?: string;
          subject?: string | null;
          snippet?: string | null;
          message_count?: number;
          participants?: string[];
          account_emails?: string[];
          has_unread?: boolean;
          is_starred?: boolean;
          is_archived?: boolean;
          latest_classification?: string | null;
          campaign_id?: string | null;
          campaign_name?: string | null;
          latest_message_date?: string;
          earliest_message_date?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      suppression_list: {
        Row: {
          id: string;
          org_id: string;
          email: string;
          reason: string;
          source: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          email: string;
          reason: string;
          source?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          email?: string;
          reason?: string;
          source?: string | null;
          created_at?: string;
        };
      };
    };
  };
};

// Standalone interfaces for use throughout the app
export interface EmailAccount {
  id: string;
  org_id: string;
  email: string;
  display_name: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  imap_host: string | null;
  imap_port: number;
  imap_secure: boolean;
  server_pair_id: string | null;
  daily_send_limit: number;
  sends_today: number;
  warmup_day: number;
  status: string;
  last_error: string | null;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecipient {
  id: string;
  org_id: string;
  campaign_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  custom_fields: Record<string, unknown>;
  assigned_account_id: string | null;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  bounce_type: string | null;
  message_id: string | null;
  created_at: string;
}

export interface EmailSendLog {
  id: string;
  org_id: string;
  campaign_id: string | null;
  recipient_id: string | null;
  account_id: string | null;
  from_email: string;
  from_name: string | null;
  to_email: string;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  message_id: string | null;
  smtp_response: string | null;
  status: string;
  error_message: string | null;
  retry_count: number;
  tracking_id: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface Campaign {
  id: string;
  org_id: string;
  snovio_id: string | null;
  name: string;
  region: string;
  store_chain: string;
  recipients: number;
  open_rate: number | null;
  reply_rate: number | null;
  bounce_rate: number | null;
  status: string;
  subject_lines: string[];
  body_html: string | null;
  body_text: string | null;
  sending_schedule: Record<string, unknown> | null;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  total_replied: number;
  total_bounced: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CampaignStats {
  total_recipients: number;
  sent: number;
  pending: number;
  failed: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
}

// B8: Sequences + Subsequences

export interface ABVariant {
  variant: string; // "A", "B", "C", "D"
  subject: string;
  body_html: string;
  body_text: string;
}

export interface SequenceStep {
  step_number: number;
  delay_days: number;
  delay_hours: number;
  subject: string;
  body_html: string;
  body_text: string;
  send_in_same_thread: boolean;
  ab_variants: ABVariant[];
}

export interface CampaignSequence {
  id: string;
  org_id: string;
  campaign_id: string;
  name: string;
  sequence_type: string; // 'primary' | 'subsequence'
  sort_order: number;
  trigger_event: string | null;
  trigger_condition: Record<string, unknown> | null;
  trigger_priority: number;
  persona: string | null;
  steps: SequenceStep[];
  status: string;
  created_at: string;
  updated_at: string;
}

export interface LeadSequenceHistoryEvent {
  event: string; // 'sent' | 'replied' | 'moved' | 'bounced' | 'opted_out'
  step?: number;
  at: string;
  message_id?: string;
  classification?: string;
  from_sequence?: string;
  to_sequence?: string;
}

export interface LeadSequenceState {
  id: string;
  org_id: string;
  recipient_id: string;
  campaign_id: string;
  sequence_id: string;
  current_step: number;
  total_steps: number;
  status: string; // 'active' | 'paused' | 'completed' | 'replied' | 'bounced' | 'opted_out' | 'moved_to_subsequence'
  next_send_at: string | null;
  last_sent_at: string | null;
  assigned_variant: string | null;
  assigned_account_id: string | null;
  last_message_id: string | null;
  history: LeadSequenceHistoryEvent[];
  created_at: string;
  updated_at: string;
}

// B9: Unified Inbox

export interface InboxMessage {
  id: number;
  org_id: string;
  account_id: string;
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  thread_id: number | null;
  parent_id: number | null;
  direction: string;
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  body_preview: string | null;
  reply_only_text: string | null;
  classification: string | null;
  classification_confidence: number | null;
  campaign_id: string | null;
  recipient_id: string | null;
  sequence_step: number | null;
  opened_at: string | null;
  clicked_at: string | null;
  imap_uid: number | null;
  imap_modseq: number | null;
  mailbox: string;
  is_read: boolean;
  is_starred: boolean;
  is_archived: boolean;
  is_deleted: boolean;
  has_attachments: boolean;
  attachment_count: number;
  received_date: string;
  created_at: string;
}

export interface InboxThread {
  id: number;
  org_id: string;
  subject: string | null;
  snippet: string | null;
  message_count: number;
  participants: string[];
  account_emails: string[];
  has_unread: boolean;
  is_starred: boolean;
  is_archived: boolean;
  latest_classification: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  latest_message_date: string;
  earliest_message_date: string;
  created_at: string;
  updated_at: string;
}

export interface SuppressionEntry {
  id: string;
  org_id: string;
  email: string;
  reason: string;
  source: string | null;
  created_at: string;
}
