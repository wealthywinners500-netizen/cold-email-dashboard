/**
 * Utility functions for parsing HestiaCP CLI output
 * Used by hestia-scripts.ts to interpret v-command responses
 */

/**
 * Represents a DNS record from HestiaCP
 */
export interface DNSRecord {
  id: string;
  type: string;
  host: string;
  value: string;
  priority?: number;
  ttl: number;
}

/**
 * Represents a mail account from HestiaCP
 */
export interface MailAccount {
  username: string;
  quota: string;
  disk: string;
}

/**
 * Represents installation progress
 */
export interface InstallProgress {
  step: string;
  progress: number;
}

/**
 * Parses DNS records from HestiaCP output
 * Format: tab-separated RECORD_ID RECORD(host) TYPE PRIORITY VALUE SUSPENDED TIME DATE TTL
 * Handles both plain and JSON formats
 *
 * @param output Raw output from `v-list-dns-records admin DOMAIN`
 * @returns Array of DNS records
 */
export function parseDNSRecords(output: string): DNSRecord[] {
  if (!output || !output.trim()) {
    return [];
  }

  // Try to parse as JSON first (some versions return JSON)
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed.map((record: any) => ({
        id: String(record.id || record.RECORD_ID || ""),
        type: String(record.type || record.TYPE || ""),
        host: String(record.host || record.HOST || ""),
        value: String(record.value || record.VALUE || ""),
        priority: record.priority || record.PRIORITY ? Number(record.priority || record.PRIORITY) : undefined,
        ttl: Number(record.ttl || record.TTL || 3600),
      })).filter((r) => r.id && r.type);
    }
  } catch {
    // Not JSON, continue with plain text parsing
  }

  // Parse plain format: tab-separated
  // HestiaCP v-list-dns-records plain column order:
  //   ID  RECORD(host)  TYPE  PRIORITY  VALUE  SUSPENDED  TIME  DATE  TTL
  // Note: PRIORITY is always present (empty or '-' for non-MX/SRV records)
  const lines = output.split("\n");
  const records: DNSRecord[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("\t");
    if (parts.length < 5) continue; // Need at least ID, HOST, TYPE, PRIORITY, VALUE

    try {
      const id = parts[0]?.trim();
      const host = parts[1]?.trim();      // RECORD column = hostname (@, mail1, etc.)
      const type = parts[2]?.trim();      // TYPE column (A, MX, NS, TXT, etc.)
      const priorityStr = parts[3]?.trim(); // PRIORITY column (number for MX/SRV, empty/- otherwise)
      const value = parts[4]?.trim();     // VALUE column
      // parts[5] = SUSPENDED, parts[6] = TIME, parts[7] = DATE
      const ttlStr = parts[8]?.trim();    // TTL column

      // Validate required fields
      if (!id || !type || host === undefined || !value) continue;

      // Parse priority for MX/SRV records
      let priority: number | undefined;
      if (["MX", "SRV"].includes(type.toUpperCase()) && priorityStr && priorityStr !== '-' && priorityStr !== '') {
        priority = Number(priorityStr);
      }

      const ttl = (ttlStr && !isNaN(Number(ttlStr))) ? Number(ttlStr) : 3600;

      records.push({
        id,
        type,
        host,
        value,
        priority: (priority !== undefined && !isNaN(priority)) ? priority : undefined,
        ttl,
      });
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  return records;
}

/**
 * Parses DKIM output from HestiaCP
 * Extracts the complete DKIM TXT record value
 *
 * @param output Raw output from `v-list-mail-domain-dkim-dns admin DOMAIN`
 * @returns DKIM value string (p=... format) or empty string
 */
export function parseDKIMOutput(output: string): string {
  if (!output || !output.trim()) {
    return "";
  }

  // HestiaCP typically returns the DKIM record in a format like:
  // selector._domainkey.example.com. IN TXT "v=DKIM1; ... ; p=<key>"
  // or just the key portion on multiple lines

  const lines = output.split("\n");
  let dkimValue = "";

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Look for the p= part which indicates the public key
    if (trimmed.includes("p=")) {
      // Extract everything from p= onwards
      const pIndex = trimmed.indexOf("p=");
      const extracted = trimmed.substring(pIndex);

      // Remove trailing quotes, semicolons, parentheses if present
      dkimValue = extracted.replace(/["';)\s]*$/, "").trim();

      // If we found a good match, return it
      if (dkimValue.startsWith("p=")) {
        return dkimValue;
      }
    }

    // Also check if the line is just base64 content (the key itself)
    if (trimmed && !trimmed.includes("IN") && !trimmed.includes("TXT") && dkimValue) {
      // Append to existing DKIM value (for multiline keys)
      dkimValue += trimmed;
    }
  }

  // If we found a partial key, try to construct the full DKIM record
  if (dkimValue && dkimValue.startsWith("p=")) {
    return dkimValue;
  }

  // Last resort: look for base64-like content in the output
  const base64Match = output.match(/p=([A-Za-z0-9+/=]+)/);
  if (base64Match) {
    return `p=${base64Match[1]}`;
  }

  return "";
}

/**
 * Parses mail accounts from HestiaCP output
 * Format: tab-separated USERNAME QUOTA DISK
 *
 * @param output Raw output from `v-list-mail-accounts admin DOMAIN plain`
 * @returns Array of mail accounts
 */
export function parseMailAccounts(output: string): MailAccount[] {
  if (!output || !output.trim()) {
    return [];
  }

  // Try JSON first
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed
        .map((account: any) => ({
          username: String(account.username || account.USERNAME || ""),
          quota: String(account.quota || account.QUOTA || ""),
          disk: String(account.disk || account.DISK || ""),
        }))
        .filter((a) => a.username);
    }
  } catch {
    // Not JSON, continue with plain text parsing
  }

  // Parse plain format: tab-separated
  const lines = output.split("\n");
  const accounts: MailAccount[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;

    try {
      const username = parts[0]?.trim();
      const quota = parts[1]?.trim();
      const disk = parts[2]?.trim();

      if (!username) continue;

      accounts.push({
        username,
        quota: quota || "",
        disk: disk || "",
      });
    } catch {
      continue;
    }
  }

  return accounts;
}

/**
 * Parses installation progress from HestiaCP installer output
 * Format: "[Step N/Total] Description" or similar
 *
 * @param line Single line from installer output
 * @returns Progress object with step description and percentage, or null
 */
export function parseInstallProgress(line: string): InstallProgress | null {
  if (!line || !line.trim()) {
    return null;
  }

  const trimmed = line.trim();

  // Try to match patterns like "[Step 5/10]", "[5/10]", "Step 5 of 10", etc.
  const stepMatch = trimmed.match(/(?:\[)?(?:step\s+)?(\d+)\s*(?:\/|of)\s*(\d+)(?:\])?/i);

  if (!stepMatch) {
    return null;
  }

  try {
    const current = Number(stepMatch[1]);
    const total = Number(stepMatch[2]);

    if (isNaN(current) || isNaN(total) || total === 0) {
      return null;
    }

    // Calculate progress percentage
    const progress = Math.min(100, Math.round((current / total) * 100));

    // Extract step description (everything after the step indicator)
    let step = trimmed;
    const stepIndicatorMatch = trimmed.match(/(?:\[)?(?:step\s+)?\d+\s*(?:\/|of)\s*\d+(?:\])?[:\s]*/i);
    if (stepIndicatorMatch) {
      step = trimmed.substring(stepIndicatorMatch[0].length).trim();
    }

    // Use indicator + description if we have a good description, otherwise use generic
    if (!step || step.length === 0) {
      step = `Step ${current} of ${total}`;
    } else {
      step = `Step ${current} of ${total}: ${step}`;
    }

    return {
      step,
      progress,
    };
  } catch {
    return null;
  }
}

/**
 * Parses domain list from HestiaCP output
 * Handles output from v-list-dns-domains or v-list-mail-domains
 *
 * @param output Raw output from v-list commands
 * @returns Array of domain names
 */
export function parseDomainList(output: string): string[] {
  if (!output || !output.trim()) {
    return [];
  }

  // Try JSON first
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed.map((item: any) => String(item.domain || item.DOMAIN || item)).filter((d) => d && d.length > 0);
    }
  } catch {
    // Not JSON, continue with plain text parsing
  }

  // Parse plain format: one domain per line
  const lines = output.split("\n");
  const domains: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Extract domain name (first field if tab-separated, or the whole line)
    const domain = trimmed.split("\t")[0]?.trim();

    // Validate it looks like a domain
    if (domain && domain.includes(".") && !domain.startsWith("-")) {
      domains.push(domain);
    }
  }

  return domains;
}
