import { createAdminClient } from '@/lib/supabase/server';

const DEAN_ORG_ID = 'org_dean_1';

async function seedDeanOrganization() {
  const adminClient = await createAdminClient();

  try {
    // Create or update Dean's organization
    const { data: org, error: orgError } = await adminClient
      .from('organizations')
      .upsert(
        {
          id: DEAN_ORG_ID,
          clerk_org_id: DEAN_ORG_ID,
          name: 'StealthMail Operations',
        },
        { onConflict: 'id' }
      )
      .select()
      .single();

    if (orgError) throw orgError;
    console.log('Organization seeded:', org);

    // Seed server pairs
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      org_id: DEAN_ORG_ID,
      pair_number: i + 1,
      domain: `mail-pair-${i + 1}.stealthmail.com`,
      ip1: `192.168.${i}.1`,
      ip2: `192.168.${i}.2`,
      status: i < 8 ? 'complete' : 'planning',
      errors: 0,
    }));

    const { error: pairsError } = await adminClient
      .from('server_pairs')
      .upsert(pairs, { onConflict: 'org_id,pair_number' });

    if (pairsError) throw pairsError;
    console.log('Server pairs seeded');

    // Seed email accounts
    const accounts = Array.from({ length: 20 }, (_, i) => ({
      org_id: DEAN_ORG_ID,
      provider: 'snov',
      email: `account${i + 1}@stealthmail.com`,
      status: 'active',
      warm_up_day: Math.floor(Math.random() * 14),
    }));

    const { error: accountsError } = await adminClient
      .from('email_accounts')
      .upsert(accounts, { onConflict: 'org_id,email' });

    if (accountsError) throw accountsError;
    console.log('Email accounts seeded');

    // Seed campaigns
    const campaigns = [
      { name: 'LI Medical Spas Batch A', region: 'NY', leads_count: 1250 },
      { name: 'LI Medical Spas Batch B', region: 'NY', leads_count: 1100 },
      { name: 'Atlanta Dental Offices', region: 'GA', leads_count: 3200 },
      { name: 'Houston Dentists', region: 'TX', leads_count: 2850 },
    ];

    const { error: campaignsError } = await adminClient
      .from('campaigns')
      .upsert(
        campaigns.map(c => ({ org_id: DEAN_ORG_ID, ...c, status: 'active' })),
        { onConflict: 'org_id,name' }
      );

    if (campaignsError) throw campaignsError;
    console.log('Campaigns seeded');

    console.log('✅ Seed completed successfully!');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  }
}

// Run seed if executed directly
if (require.main === module) {
  seedDeanOrganization();
}

export { seedDeanOrganization };
