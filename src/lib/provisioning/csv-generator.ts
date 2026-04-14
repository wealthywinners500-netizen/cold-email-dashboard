// ============================================
// B15-5: Snov.io CSV Generator
// Format matches Snov.io's bulk email account import:
//   https://snov.io/knowledgebase/how-to-import-email-sender-accounts/
//
// Required columns (strict order):
//   From email, From name, SMTP host, SMTP port, Password, IMAP host, IMAP port
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
 * Column order per Snov.io docs:
 *   From email, From name, SMTP host, SMTP port, Password, IMAP host, IMAP port
 *
 * SMTP/IMAP host is mail1.nsDomain or mail2.nsDomain
 * SMTP port: 587 (STARTTLS — industry standard per RFC 6409)
 * IMAP port: 993 (SSL)
 */
export function generateSnovioCSV(params: CSVGeneratorParams): string {
  const { serverPair, mailAccounts } = params;
  const { nsDomain } = serverPair;

  const header = 'From email,From name,SMTP host,SMTP port,Password,IMAP host,IMAP port';
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
      displayName,
      mailHost,
      '587',
      account.password,
      mailHost,
      '993',
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

  const header = 'From email,From name,SMTP host,SMTP port,Password,IMAP host,IMAP port';
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
      displayName,
      mailHost,
      '587',
      defaultPassword,
      mailHost,
      '993',
    ].join(',');
  });

  return [header, ...rows].join('\n');
}
