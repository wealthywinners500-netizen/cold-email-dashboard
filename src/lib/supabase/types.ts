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
    };
  };
};
