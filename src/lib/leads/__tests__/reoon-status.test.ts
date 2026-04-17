import { describe, it, expect } from 'vitest';
import { mapReoonStatus } from '@/lib/leads/reoon-status';
import { shouldDropByPrefix } from '@/lib/leads/prefix-filter';

describe('mapReoonStatus', () => {
  it('safe → valid', () => expect(mapReoonStatus('safe').email_status).toBe('valid'));
  it('role_account stays role_account', () =>
    expect(mapReoonStatus('role_account').email_status).toBe('role_account'));
  it('catch_all stays catch_all', () =>
    expect(mapReoonStatus('catch_all').email_status).toBe('catch_all'));
  it('invalid/disabled/disposable → invalid', () => {
    for (const s of ['invalid', 'disabled', 'disposable']) {
      expect(mapReoonStatus(s).email_status).toBe('invalid');
    }
  });
  it('spamtrap triggers auto_suppress', () =>
    expect(mapReoonStatus('spamtrap').auto_suppress).toBe(true));
  it('unknown/inbox_full → unknown, no suppress', () => {
    expect(mapReoonStatus('unknown').email_status).toBe('unknown');
    expect(mapReoonStatus('unknown').auto_suppress).toBe(false);
    expect(mapReoonStatus('inbox_full').email_status).toBe('unknown');
  });
});

describe('shouldDropByPrefix', () => {
  it('drops noreply', () => expect(shouldDropByPrefix('noreply@foo.com')).toBe(true));
  it('KEEPS admin@ per hard lesson 67', () =>
    expect(shouldDropByPrefix('admin@foo.com')).toBe(false));
  it('KEEPS info@', () => expect(shouldDropByPrefix('info@foo.com')).toBe(false));
  it('KEEPS office@', () => expect(shouldDropByPrefix('office@foo.com')).toBe(false));
});
