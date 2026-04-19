/**
 * Unit tests for await_auth_dns step — 10-resolver consensus.
 * Run: tsx src/lib/provisioning/__tests__/await-auth-dns.test.ts
 */

import type { SSHManager } from '../ssh-manager';
import {
  runAwaitAuthDns,
  CONSENSUS_RESOLVERS,
  MIN_CONSENSUS,
} from '../steps/await-auth-dns';

type ExecFn = (cmd: string, opts?: { timeout?: number }) => Promise<{ stdout: string; code?: number; stderr?: string }>;

function makeSsh(exec: ExecFn): SSHManager {
  return { exec } as unknown as SSHManager;
}

/**
 * Build an exec stub that returns `responseByResolver[resolverIp]` for any
 * dig command addressed to that resolver, and '' for any other command.
 * Matches the shape produced by `dig +short ${name} ${type} @${resolver}`.
 */
function makeResolverStub(responseByResolver: Record<string, string>): ExecFn {
  return async (cmd: string) => {
    const match = cmd.match(/@(\S+)/);
    const resolver = match?.[1];
    if (!resolver) return { stdout: '' };
    return { stdout: responseByResolver[resolver] ?? '' };
  };
}

async function assert(condition: unknown, label: string): Promise<void> {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  } else {
    console.log(`PASS: ${label}`);
  }
}

async function testPassesWhenAllResolversAgree() {
  // Every resolver returns the right A record for every A query,
  // and minimal valid TXT/MX strings for the corresponding types.
  const exec: ExecFn = async (cmd: string) => {
    // Heuristic: if it's an A query, return one of the two server IPs
    // based on whether the name contains 'mail2' or 'ns2' (S2) — otherwise S1.
    if (cmd.includes(' A @')) {
      const onS2 = / ns2\.| mail2\./.test(cmd);
      return { stdout: onS2 ? '10.0.0.2' : '10.0.0.1' };
    }
    if (cmd.includes(' MX @')) {
      const onS2 = false; // all domains = S1 for simplicity here
      return { stdout: onS2 ? '10 mail2.ns.example.' : '10 mail1.ns.example.' };
    }
    if (cmd.includes('_dmarc') && cmd.includes(' TXT @')) {
      return { stdout: '"v=DMARC1; p=quarantine; pct=100"' };
    }
    if (cmd.includes('_domainkey') && cmd.includes(' TXT @')) {
      return { stdout: '"v=DKIM1; k=rsa; p=AAAA"' };
    }
    if (cmd.includes(' TXT @')) {
      return { stdout: '"v=spf1 ip4:10.0.0.1 -all"' };
    }
    return { stdout: '' };
  };

  const result = await runAwaitAuthDns({
    ssh1: makeSsh(exec),
    nsDomain: 'ns.example',
    server1IP: '10.0.0.1',
    server2IP: '10.0.0.2',
    server1Domains: ['a.example', 'b.example'],
    server2Domains: [],
    log: () => {},
    maxIterations: 1,
    timeoutMs: 60_000,
  });

  await assert(result.success, 'all resolvers agree → success');
  await assert(result.metadata.iterations === 1, 'converges on iteration 1');
  await assert(result.metadata.expectationsPassed === result.metadata.expectationsTotal, 'all expectations pass');
}

async function testFailsWhen6Of10Agree() {
  // Force only 6 resolvers to return the right A; the other 4 return empty.
  const goodResolvers = new Set(CONSENSUS_RESOLVERS.slice(0, 6));
  const exec: ExecFn = async (cmd: string) => {
    const resolver = cmd.match(/@(\S+)/)?.[1] ?? '';
    if (!goodResolvers.has(resolver)) return { stdout: '' };
    if (cmd.includes(' A @')) {
      const onS2 = / ns2\.| mail2\./.test(cmd);
      return { stdout: onS2 ? '10.0.0.2' : '10.0.0.1' };
    }
    if (cmd.includes(' MX @')) return { stdout: '10 mail1.ns.example.' };
    if (cmd.includes('_dmarc')) return { stdout: '"v=DMARC1; p=quarantine"' };
    if (cmd.includes('_domainkey')) return { stdout: '"v=DKIM1; k=rsa; p=AAAA"' };
    if (cmd.includes(' TXT @')) return { stdout: '"v=spf1 -all"' };
    return { stdout: '' };
  };

  const result = await runAwaitAuthDns({
    ssh1: makeSsh(exec),
    nsDomain: 'ns.example',
    server1IP: '10.0.0.1',
    server2IP: '10.0.0.2',
    server1Domains: ['a.example'],
    server2Domains: [],
    log: () => {},
    maxIterations: 1,
    timeoutMs: 60_000,
  });

  await assert(!result.success, '6/10 consensus fails (need ≥7)');
  await assert(result.metadata.expectationsPassed === 0, 'zero expectations pass');
  await assert(result.error !== undefined, 'error message populated');
}

async function testPassesWith7Of10() {
  const goodResolvers = new Set(CONSENSUS_RESOLVERS.slice(0, 7));
  const exec: ExecFn = async (cmd: string) => {
    const resolver = cmd.match(/@(\S+)/)?.[1] ?? '';
    if (!goodResolvers.has(resolver)) return { stdout: '' };
    if (cmd.includes(' A @')) {
      const onS2 = / ns2\.| mail2\./.test(cmd);
      return { stdout: onS2 ? '10.0.0.2' : '10.0.0.1' };
    }
    if (cmd.includes(' MX @')) return { stdout: '10 mail1.ns.example.' };
    if (cmd.includes('_dmarc')) return { stdout: '"v=DMARC1; p=quarantine"' };
    if (cmd.includes('_domainkey')) return { stdout: '"v=DKIM1; k=rsa; p=AAAA"' };
    if (cmd.includes(' TXT @')) return { stdout: '"v=spf1 -all"' };
    return { stdout: '' };
  };

  const result = await runAwaitAuthDns({
    ssh1: makeSsh(exec),
    nsDomain: 'ns.example',
    server1IP: '10.0.0.1',
    server2IP: '10.0.0.2',
    server1Domains: ['a.example'],
    server2Domains: [],
    log: () => {},
    maxIterations: 1,
    timeoutMs: 60_000,
  });

  await assert(result.success, '7/10 consensus passes (MIN_CONSENSUS threshold)');
}

async function testTimeoutHonored() {
  // Every resolver returns nothing — runner must time out, not spin.
  const exec: ExecFn = async () => ({ stdout: '' });

  const start = Date.now();
  const result = await runAwaitAuthDns({
    ssh1: makeSsh(exec),
    nsDomain: 'ns.example',
    server1IP: '10.0.0.1',
    server2IP: '10.0.0.2',
    server1Domains: [],
    server2Domains: [],
    log: () => {},
    maxIterations: 2,
    timeoutMs: 500,
  });
  const elapsed = Date.now() - start;

  await assert(!result.success, 'empty resolver responses → timeout failure');
  await assert(elapsed < 10_000, `timeout returns promptly (elapsed=${elapsed}ms, <10s bound)`);
  await assert(result.metadata.iterations >= 1, 'at least one iteration ran');
}

async function testMinConsensusIsSeven() {
  await assert(MIN_CONSENSUS === 7, 'MIN_CONSENSUS === 7');
  await assert(CONSENSUS_RESOLVERS.length === 10, 'exactly 10 resolvers configured');
  // Operator diversity: unique first octets ≥ 7 (rough sanity check)
  const firstOctets = new Set(CONSENSUS_RESOLVERS.map((r) => r.split('.')[0]));
  await assert(firstOctets.size >= 7, `operator diversity (${firstOctets.size} distinct first octets)`);
}

async function main() {
  console.log('--- await-auth-dns unit tests ---');
  await testMinConsensusIsSeven();
  await testPassesWhenAllResolversAgree();
  await testPassesWith7Of10();
  await testFailsWhen6Of10Agree();
  await testTimeoutHonored();
  console.log('--- all tests passed ---');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
