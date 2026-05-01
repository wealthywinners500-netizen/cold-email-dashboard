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
          total_unsubscribed: number;
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
          total_unsubscribed?: number;
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
          total_unsubscribed?: number;
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
          sync_state: Record<string, unknown>;
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
          sync_state?: Record<string, unknown>;
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
          sync_state?: Record<string, unknown>;
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
      tracking_events: {
        Row: {
          id: number;
          org_id: string;
          campaign_id: string | null;
          recipient_id: string | null;
          send_log_id: string | null;
          tracking_id: string;
          event_type: string;
          clicked_url: string | null;
          bounce_type: string | null;
          bounce_code: string | null;
          bounce_message: string | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          org_id: string;
          campaign_id?: string | null;
          recipient_id?: string | null;
          send_log_id?: string | null;
          tracking_id: string;
          event_type: string;
          clicked_url?: string | null;
          bounce_type?: string | null;
          bounce_code?: string | null;
          bounce_message?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          org_id?: string;
          campaign_id?: string | null;
          recipient_id?: string | null;
          send_log_id?: string | null;
          tracking_id?: string;
          event_type?: string;
          clicked_url?: string | null;
          bounce_type?: string | null;
          bounce_code?: string | null;
          bounce_message?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
      };
      lead_contacts: {
        Row: {
          id: string;
          org_id: string;
          business_name: string | null;
          business_type: string | null;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          phone: string | null;
          website: string | null;
          address: string | null;
          city: string | null;
          state: string | null;
          zip: string | null;
          country: string;
          google_rating: number | null;
          google_reviews_count: number | null;
          google_place_id: string | null;
          email_status: string;
          verified_at: string | null;
          verification_source: string | null;
          verification_result: Record<string, unknown>;
          scrape_source: string;
          scrape_query: string | null;
          scraped_at: string | null;
          times_emailed: number;
          last_emailed_at: string | null;
          suppressed: boolean;
          tags: string[];
          custom_fields: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          business_name?: string | null;
          business_type?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          email?: string | null;
          phone?: string | null;
          website?: string | null;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          country?: string;
          google_rating?: number | null;
          google_reviews_count?: number | null;
          google_place_id?: string | null;
          email_status?: string;
          verified_at?: string | null;
          verification_source?: string | null;
          verification_result?: Record<string, unknown>;
          scrape_source?: string;
          scrape_query?: string | null;
          scraped_at?: string | null;
          times_emailed?: number;
          last_emailed_at?: string | null;
          suppressed?: boolean;
          tags?: string[];
          custom_fields?: Record<string, unknown>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          business_name?: string | null;
          business_type?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          email?: string | null;
          phone?: string | null;
          website?: string | null;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          country?: string;
          google_rating?: number | null;
          google_reviews_count?: number | null;
          google_place_id?: string | null;
          email_status?: string;
          verified_at?: string | null;
          verification_source?: string | null;
          verification_result?: Record<string, unknown>;
          scrape_source?: string;
          scrape_query?: string | null;
          scraped_at?: string | null;
          times_emailed?: number;
          last_emailed_at?: string | null;
          suppressed?: boolean;
          tags?: string[];
          custom_fields?: Record<string, unknown>;
          created_at?: string;
          updated_at?: string;
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
  sync_state: Record<string, unknown>;
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
  total_unsubscribed: number;
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

// B10: Tracking + Bounce Handling

export interface TrackingEvent {
  id: number;
  org_id: string;
  campaign_id: string | null;
  recipient_id: string | null;
  send_log_id: string | null;
  tracking_id: string;
  event_type: 'open' | 'click' | 'bounce_hard' | 'bounce_soft' | 'unsubscribe';
  clicked_url: string | null;
  bounce_type: string | null;
  bounce_code: string | null;
  bounce_message: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface CampaignAnalytics {
  total_sent: number;
  total_delivered: number;
  total_opened: number;
  total_clicked: number;
  total_replied: number;
  total_bounced: number;
  total_unsubscribed: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
  unsubscribe_rate: number;
}

// B11: Lead Database — Individual Contacts

export interface LeadContact {
  id: string;
  org_id: string;
  business_name: string | null;
  business_type: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  google_rating: number | null;
  google_reviews_count: number | null;
  google_place_id: string | null;
  email_status: 'valid' | 'invalid' | 'risky' | 'unknown' | 'pending';
  verified_at: string | null;
  verification_source: string | null;
  verification_result: Record<string, any>;
  scrape_source: 'outscraper' | 'csv' | 'manual';
  scrape_query: string | null;
  scraped_at: string | null;
  times_emailed: number;
  last_emailed_at: string | null;
  suppressed: boolean;
  tags: string[];
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface LeadContactStats {
  total: number;
  pending: number;
  valid: number;
  invalid: number;
  risky: number;
  unknown: number;
  suppressed: number;
  by_state: { state: string; count: number }[];
  by_type: { type: string; count: number }[];
}

export interface OutscraperSearchResult {
  found: number;
  imported: number;
  duplicates: number;
  contacts: LeadContact[];
}

// V1a: custom lists + async Outscraper task tracking (migration 023)

export interface OutscraperFilters {
  // V8 (2026-04-30): rewritten to /tasks API shape. `categories` + `locations`
  // replace the V1a single-string `query` field. `query`/`location` kept for
  // one cycle as deprecated free-text inputs the form may pre-populate from
  // suggested_filters but no longer drive the request.
  categories: string[];
  locations: string[];
  use_zip_codes: boolean;
  ignore_without_emails: boolean;
  drop_email_duplicates: boolean;
  organizations_per_query_limit: number;
  limit: number;
  preferred_contacts: string[];
  region?: string;
  vertical?: string;
  sub_vertical?: string;
  language: string;
  /** @deprecated V1a — kept for one release cycle while UI migrates. */
  query?: string;
  /** @deprecated V1a — kept for one release cycle while UI migrates. */
  location?: string;
}

export interface LeadList {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  region: string | null;
  vertical: string | null;
  sub_vertical: string | null;
  suggested_filters: Partial<OutscraperFilters> | Record<string, unknown>;
  total_leads: number;
  last_scrape_status: 'submitted' | 'polling' | 'downloading' | 'complete' | 'failed' | null;
  last_scrape_started_at: string | null;
  last_scrape_completed_at: string | null;
  last_scrape_error: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type OutscraperTaskStatus =
  | 'submitted'
  | 'polling'
  | 'downloading'
  | 'complete'
  | 'failed';

export interface OutscraperTask {
  id: string;
  org_id: string;
  lead_list_id: string;
  outscraper_task_id: string;
  status: OutscraperTaskStatus;
  filters: OutscraperFilters | Record<string, unknown>;
  estimated_count: number | null;
  estimated_cost_cents: number | null;
  actual_count: number | null;
  results_location: string | null;
  error_message: string | null;
  last_polled_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface VerificationResult {
  verified: number;
  valid: number;
  invalid: number;
  risky: number;
}

export interface SystemAlert {
  id: string;
  org_id: string;
  alert_type: 'smtp_auth_failure' | 'imap_error' | 'high_bounce_rate' | 'worker_down' | 'queue_backup';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  details: Record<string, any>;
  account_id: string | null;
  acknowledged: boolean;
  acknowledged_at: string | null;
  created_at: string;
}

export interface SystemHealth {
  worker: {
    last_heartbeat: string | null;
    jobs_today: number;
    errors_today: number;
    is_healthy: boolean;
  };
  email_accounts: {
    total: number;
    syncing: number;
    errored: number;
    disabled: number;
  };
  delivery: {
    sent_today: number;
    bounced_today: number;
    bounce_rate: number;
    suppressed_total: number;
  };
  queue: {
    pending: number;
    failed: number;
  };
  alerts: {
    unacknowledged: number;
    recent: SystemAlert[];
  };
  overall: 'green' | 'yellow' | 'red';
}

export interface DashboardMetrics {
  active_campaigns: { count: number; total_recipients: number; percent_sent: number };
  inbox: { unread: number; today_replies: number; classification_breakdown: Record<string, number> };
  leads: { total_contacts: number; verified_percent: number; top_cities: { city: string; count: number }[] };
  health: 'green' | 'yellow' | 'red';
}

// ============================================
// B15: Provisioning Tables
// ============================================

export type VPSProviderType = 'clouding' | 'digitalocean' | 'hetzner' | 'vultr' | 'linode' | 'contabo' | 'ovh' | 'custom';
export type DNSRegistrarType = 'ionos' | 'namecheap' | 'godaddy' | 'cloudflare' | 'porkbun' | 'namecom' | 'dynadot' | 'custom';
export type ProvisioningStatusType = 'pending' | 'in_progress' | 'completed' | 'failed' | 'rolled_back' | 'cancelled';
export type ProvisioningStepType = 'create_vps' | 'set_ptr' | 'configure_registrar' | 'install_hestiacp' | 'setup_dns_zones' | 'setup_mail_domains' | 'security_hardening' | 'verification_gate';
export type ProvisioningStepStatusType = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'manual_required';

export interface VPSProviderRow {
  id: string;
  org_id: string;
  name: string;
  provider_type: VPSProviderType;
  api_key_encrypted: string | null;
  api_secret_encrypted: string | null;
  config: Record<string, unknown>;
  is_default: boolean;
  port_25_status: string;
  created_at: string;
  updated_at: string;
}

export interface DNSRegistrarRow {
  id: string;
  org_id: string;
  name: string;
  registrar_type: DNSRegistrarType;
  api_key_encrypted: string | null;
  api_secret_encrypted: string | null;
  config: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProvisioningJobRow {
  id: string;
  org_id: string;
  vps_provider_id: string | null;
  dns_registrar_id: string | null;
  status: ProvisioningStatusType;
  ns_domain: string;
  sending_domains: string[];
  mail_accounts_per_domain: number;
  mail_account_style: 'random_names' | 'custom';
  admin_email: string | null;
  server1_ip: string | null;
  server2_ip: string | null;
  server1_provider_id: string | null;
  server2_provider_id: string | null;
  server_pair_id: string | null;
  progress_pct: number;
  current_step: ProvisioningStepType | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  config: Record<string, unknown>;
}

export interface ProvisioningStepRow {
  id: string;
  job_id: string;
  step_type: ProvisioningStepType;
  step_order: number;
  status: ProvisioningStepStatusType;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  output: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SSHCredentialRow {
  id: string;
  org_id: string;
  server_ip: string;
  hostname: string | null;
  username: string;
  password_encrypted: string | null;
  private_key_encrypted: string | null;
  port: number;
  provisioning_job_id: string | null;
  created_at: string;
  updated_at: string;
}
