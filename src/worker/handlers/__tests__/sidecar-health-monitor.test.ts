/**
 * CC #5b1 — sidecar-health-monitor unit tests.
 *
 * Pure helper tests + a tiny in-process http server fixture that exercises
 * the production timeout/parse logic via _probeSidecarHealthAt(url).
 *
 *   - getSidecarDeployedHosts() env parsing
 *   - _probeSidecarHealthAt() against a 127.0.0.1:0 fixture (4 cases)
 *   - Source-grep guards for constants, system_alerts wiring, cron registration
 *
 * Run via: tsx src/worker/handlers/__tests__/sidecar-health-monitor.test.ts
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  getSidecarDeployedHosts,
  _probeSidecarHealthAt,
} from '../sidecar-health-monitor';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

let tests = 0;
let failed = 0;
function test(name: string, fn: () => Promise<void> | void) {
  tests++;
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${(err as Error).message}`);
    });
}

interface Fixture {
  url: string;
  close: () => Promise<void>;
}

function startFixture(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<Fixture> {
  return new Promise((res) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('fixture: bad address');
      }
      res({
        url: `http://127.0.0.1:${addr.port}/admin/health`,
        close: () =>
          new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

console.log('\nsidecar-health-monitor tests\n');

(async () => {
  // ───── getSidecarDeployedHosts ─────
  await test('getSidecarDeployedHosts: empty env returns empty array', () => {
    delete process.env.SIDECAR_DEPLOYED_HOSTS;
    assert(getSidecarDeployedHosts().length === 0, 'unset must return []');
    process.env.SIDECAR_DEPLOYED_HOSTS = '';
    assert(getSidecarDeployedHosts().length === 0, 'empty string must return []');
    delete process.env.SIDECAR_DEPLOYED_HOSTS;
  });

  await test('getSidecarDeployedHosts: single host', () => {
    process.env.SIDECAR_DEPLOYED_HOSTS = 'mail1.example.info';
    const hosts = getSidecarDeployedHosts();
    assert(hosts.length === 1, 'one host expected');
    assert(hosts[0] === 'mail1.example.info', 'host preserved');
    delete process.env.SIDECAR_DEPLOYED_HOSTS;
  });

  await test('getSidecarDeployedHosts: comma-separated multi-host', () => {
    process.env.SIDECAR_DEPLOYED_HOSTS =
      'mail1.example.info,mail2.example.info';
    const hosts = getSidecarDeployedHosts();
    assert(hosts.length === 2, 'two hosts expected');
    assert(hosts[0] === 'mail1.example.info', 'first');
    assert(hosts[1] === 'mail2.example.info', 'second');
    delete process.env.SIDECAR_DEPLOYED_HOSTS;
  });

  await test('getSidecarDeployedHosts: whitespace and empty entries are stripped', () => {
    process.env.SIDECAR_DEPLOYED_HOSTS =
      ' mail1.example.info ,, mail2.example.info  ';
    const hosts = getSidecarDeployedHosts();
    assert(hosts.length === 2, 'two hosts after stripping');
    assert(hosts[0] === 'mail1.example.info', 'first trimmed');
    assert(hosts[1] === 'mail2.example.info', 'second trimmed');
    delete process.env.SIDECAR_DEPLOYED_HOSTS;
  });

  // ───── _probeSidecarHealthAt against in-process http fixture ─────
  await test('probe: 200 + {status:"ok"} → ok=true', async () => {
    const fx = await startFixture((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ status: 'ok', version: '1.0.0', uptime_ms: 12345 })
      );
    });
    try {
      const r = await _probeSidecarHealthAt(fx.url);
      assert(r.ok === true, `expected ok=true, got ${JSON.stringify(r)}`);
    } finally {
      await fx.close();
    }
  });

  await test('probe: 200 + bad payload (status:"degraded") → ok=false with bad-payload error', async () => {
    const fx = await startFixture((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'degraded' }));
    });
    try {
      const r = await _probeSidecarHealthAt(fx.url);
      assert(r.ok === false, 'must reject non-ok status');
      assert(/bad payload/.test(r.error || ''), `error should mention 'bad payload', got: ${r.error}`);
    } finally {
      await fx.close();
    }
  });

  await test('probe: 503 → ok=false with HTTP-status error', async () => {
    const fx = await startFixture((req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'down' }));
    });
    try {
      const r = await _probeSidecarHealthAt(fx.url);
      assert(r.ok === false, 'must reject HTTP 503');
      assert(/HTTP 503/.test(r.error || ''), `error should mention 'HTTP 503', got: ${r.error}`);
    } finally {
      await fx.close();
    }
  });

  await test('probe: hung response triggers AbortController timeout (ok=false)', async () => {
    // Server accepts the connection but never sends a response. The
    // production HEALTH_TIMEOUT_MS is 5000ms; we wait it out and assert
    // the abort propagates. This test takes ~5.1s — slow but real.
    const fx = await startFixture((_req, _res) => {
      // never write or end — keep the socket alive
    });
    try {
      const start = Date.now();
      const r = await _probeSidecarHealthAt(fx.url);
      const elapsed = Date.now() - start;
      assert(r.ok === false, 'timeout must produce ok=false');
      assert(
        elapsed >= 4500 && elapsed <= 7000,
        `expected ~5s timeout, got ${elapsed}ms`
      );
      assert(typeof r.error === 'string' && r.error.length > 0, 'error message present');
    } finally {
      await fx.close();
    }
  });

  // ───── Source-grep guards ─────
  const here = dirname(fileURLToPath(import.meta.url));
  const handlerPath = resolve(here, '..', 'sidecar-health-monitor.ts');
  const handlerSrc = readFileSync(handlerPath, 'utf8');

  await test('handler defines FAILURE_THRESHOLD = 3 and DEDUP_WINDOW_MINUTES = 60', () => {
    assert(
      /FAILURE_THRESHOLD\s*=\s*3\b/.test(handlerSrc),
      'FAILURE_THRESHOLD must be 3'
    );
    assert(
      /DEDUP_WINDOW_MINUTES\s*=\s*60\b/.test(handlerSrc),
      'DEDUP_WINDOW_MINUTES must be 60'
    );
  });

  await test('handler writes system_alerts with alert_type=sidecar_unhealthy and severity=critical', () => {
    assert(handlerSrc.includes("alert_type: \"sidecar_unhealthy\""), 'alert_type literal');
    assert(handlerSrc.includes("severity: \"critical\""), 'severity literal');
    assert(handlerSrc.includes('.from("system_alerts")'), 'inserts to system_alerts table');
  });

  await test('handler builds health URL as https://<host>/admin/health', () => {
    assert(/https:\/\/\$\{host\}\/admin\/health/.test(handlerSrc),
      'production probe must hit https:// + /admin/health');
  });

  // ───── Worker registration grep ─────
  const indexPath = resolve(here, '..', '..', 'index.ts');
  const indexSrc = readFileSync(indexPath, 'utf8');

  await test('worker/index.ts imports handleSidecarHealthMonitor', () => {
    assert(
      /import\s*\{\s*handleSidecarHealthMonitor\s*\}\s*from\s*"\.\/handlers\/sidecar-health-monitor"/.test(
        indexSrc
      ),
      'handler import line required'
    );
  });

  await test('worker/index.ts adds sidecar-health-monitor to queueNames', () => {
    assert(
      /"sidecar-health-monitor"/.test(indexSrc),
      'queueNames array must include sidecar-health-monitor'
    );
  });

  await test('worker/index.ts registers sidecar-health-monitor cron at */15 cadence', () => {
    assert(
      /boss\.schedule\(\s*"sidecar-health-monitor",\s*"\*\/15 \* \* \* \*"\s*\)/.test(
        indexSrc
      ),
      'must schedule the cron at */15 * * * *'
    );
    assert(
      /boss\.work\(\s*"sidecar-health-monitor"/.test(indexSrc),
      'must register a worker for the queue'
    );
  });

  // ───── Final ─────
  console.log(`\n${tests - failed}/${tests} passed${failed ? `, ${failed} FAILED` : ''}`);
  if (failed > 0) process.exit(1);
})();
