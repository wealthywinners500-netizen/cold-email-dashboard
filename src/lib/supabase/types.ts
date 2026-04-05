export interface Organization {
  id: string;
  clerk_org_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ServerPair {
  id: string;
  org_id: string;
  pair_number: number;
  domain: string;
  ip1: string;
  ip2: string;
  status: 'planning' | 'in_progress' | 'complete' | 'maintenance';
  errors: number;
  created_at: string;
  updated_at: string;
}

export interface EmailAccount {
  id: string;
  org_id: string;
  provider: 'snov' | 'sendgrid';
  email: string;
  status: 'warming' | 'active' | 'paused' | 'blocked';
  warm_up_day: number;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  org_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  region: string;
  leads_count: number;
  sent_count: number;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  org_id: string;
  email: string;
  name?: string;
  company?: string;
  phone?: string;
  region: string;
  source: string;
  verified: boolean;
  status: 'new' | 'contacted' | 'interested' | 'unsubscribed';
  created_at: string;
  updated_at: string;
}

export interface FollowUpSequence {
  id: string;
  org_id: string;
  name: string;
  email_count: number;
  status: 'active' | 'paused' | 'archived';
  open_rate: number;
  reply_rate: number;
  created_at: string;
  updated_at: string;
}

export interface SMSWorkflow {
  id: string;
  org_id: string;
  name: string;
  region: string;
  status: 'active' | 'paused' | 'scheduled';
  message_count: number;
  sent_count: number;
  delivered_count: number;
  reply_count: number;
  credits_used: number;
  created_at: string;
  updated_at: string;
}
