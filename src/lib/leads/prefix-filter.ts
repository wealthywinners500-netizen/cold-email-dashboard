// Email prefix drop list (Hard Lesson #67).
// KEEP list (intentionally NOT here): info, office, contact, frontdesk,
// billing, admin, team, appointments, reception, scheduling.
// DROP list: dead-end addresses that don't reach decision-makers.
// Applied BEFORE Reoon calls so we don't spend credits verifying them.

const DROP_PREFIXES = new Set([
  'support', 'help',
  'noreply', 'no-reply', 'donotreply',
  'webmaster', 'postmaster', 'hostmaster',
  'abuse', 'bounce', 'unsubscribe',
  'privacy', 'security',
  'root', 'mailer-daemon', 'mail-daemon',
  'ftp', 'ssl-admin',
]);

export function shouldDropByPrefix(email: string): boolean {
  const prefix = email.split('@')[0]?.toLowerCase().trim() ?? '';
  return DROP_PREFIXES.has(prefix);
}
