// ============================================
// B15-5: Snov.io CSV Generator
// Matches existing snovio_csvs_v2/ format
// ============================================

export interface CSVGeneratorParams {
  serverPair: {
    server1IP: string;
    server2IP: string;
    nsDomain: string;
  };
  sendingDomains: string[];
  mailAccounts: {
    email: string;
    password: string;
    server: 'server1' | 'server2';
  }[];
}

/**
 * Generate Snov.io-compatible CSV for import.
 *
 * Format:
 *   email,password,smtp_host,smtp_port,imap_host,imap_port,name
 *
 * SMTP/IMAP host is mail1.nsDomain or mail2.nsDomain
 * SMTP port: 465 (SSL)
 * IMAP port: 993 (SSL)
 */
export function generateSnovioCSV(params: CSVGeneratorParams): string {
  const { serverPair, mailAccounts } = params;
  const { nsDomain } = serverPair;

  const header = 'email,password,smtp_host,smtp_port,imap_host,imap_port,name';
  const rows = mailAccounts.map((account) => {
    const mailHost =
      account.server === 'server1'
        ? `mail1.${nsDomain}`
        : `mail2.${nsDomain}`;

    // Extract display name from email (firstname.lastname@domain → Firstname Lastname)
    const localPart = account.email.split('@')[0];
    const displayName = localPart
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

    return [
      account.email,
      account.password,
      mailHost,
      '465',
      mailHost,
      '993',
      displayName,
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

/**
 * Generate CSV from a completed provisioning job's stored data.
 * This builds the CSV from the job config + email accounts in DB.
 */
export function generateCSVFromJobData(params: {
  nsDomain: string;
  accounts: {
    email: string;
    smtp_host: string;
    server1Hostname: string;
  }[];
  defaultPassword: string;
}): string {
  const { nsDomain, accounts, defaultPassword } = params;

  const header = 'email,password,smtp_host,smtp_port,imap_host,imap_port,name';
  const rows = accounts.map((account) => {
    // Determine which server based on smtp_host
    const isServer1 = account.smtp_host === account.server1Hostname ||
      account.smtp_host?.includes('mail1');
    const mailHost = isServer1
      ? `mail1.${nsDomain}`
      : `mail2.${nsDomain}`;

    const localPart = account.email.split('@')[0];
    const displayName = localPart
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

    return [
      account.email,
      defaultPassword,
      mailHost,
      '465',
      mailHost,
      '993',
      displayName,
    ].join(',');
  });

  return [header, ...rows].join('\n');
}
