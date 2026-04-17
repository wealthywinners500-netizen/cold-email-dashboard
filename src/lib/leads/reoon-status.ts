// Reoon status → app status mapping (Phase 1, 2026-04-17).
// Gap 3 of LEADS_CONTACTS_OUTSCRAPER_REOON_GAMEPLAN.md — preserve
// role_account and catch_all as distinct statuses. Do not collapse
// catch_all into valid; the Contacts tab + recipient picker depend on
// the three-way split (valid / role_account / catch_all).

export type ReoonStatus =
  | 'safe' | 'role_account' | 'catch_all'
  | 'invalid' | 'disabled' | 'disposable' | 'spamtrap'
  | 'inbox_full' | 'unknown';

export type AppStatus =
  | 'valid' | 'role_account' | 'catch_all'
  | 'invalid' | 'unknown' | 'suppressed';

export function mapReoonStatus(r: ReoonStatus | string): {
  email_status: AppStatus;
  auto_suppress: boolean;
} {
  switch ((r || '').toLowerCase()) {
    case 'safe':         return { email_status: 'valid',         auto_suppress: false };
    case 'role_account': return { email_status: 'role_account',  auto_suppress: false };
    case 'catch_all':    return { email_status: 'catch_all',     auto_suppress: false };
    case 'invalid':
    case 'disabled':
    case 'disposable':   return { email_status: 'invalid',       auto_suppress: false };
    case 'spamtrap':     return { email_status: 'invalid',       auto_suppress: true  };
    case 'inbox_full':
    case 'unknown':      return { email_status: 'unknown',       auto_suppress: false };
    default:             return { email_status: 'unknown',       auto_suppress: false };
  }
}
