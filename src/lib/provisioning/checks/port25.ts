// ============================================
// Port 25 reachability + SMTP banner check
// ============================================
//
// Connects to <ip>:25 and reads the SMTP greeting + EHLO response.
// Used by verification_gate to confirm a freshly-provisioned mail
// server is actually reachable from the worker VPS (which is the
// network vantage point that matters — not from Vercel serverless,
// which has port 25 egress blocked by GCP/AWS).
//
// Returns:
//   { ok: true, banner: "220 mail1.foo.info ESMTP ...", helo: "..." }
//   { ok: false, error: "..." }
//
// The check is lenient about exact banner content but requires a
// 220 greeting and a 250 response to EHLO.

import { Socket } from "net";

export interface Port25Result {
  ok: boolean;
  banner?: string;
  helo?: string;
  error?: string;
  durationMs: number;
}

export async function checkPort25(
  ip: string,
  expectedHostname: string,
  timeoutMs: number = 15_000
): Promise<Port25Result> {
  const start = Date.now();

  return new Promise<Port25Result>((resolve) => {
    const sock = new Socket();
    let buffer = "";
    let banner = "";
    let helo = "";
    let stage: "banner" | "ehlo" | "done" = "banner";
    let settled = false;

    const finish = (r: Port25Result) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve({ ...r, durationMs: Date.now() - start });
    };

    sock.setTimeout(timeoutMs);
    sock.once("timeout", () =>
      finish({
        ok: false,
        error: `Port 25 timed out after ${timeoutMs}ms`,
        durationMs: 0,
      })
    );
    sock.once("error", (err) =>
      finish({
        ok: false,
        error: `Port 25 socket error: ${(err as Error).message}`,
        durationMs: 0,
      })
    );

    sock.once("connect", () => {
      // Wait for banner — server speaks first.
    });

    sock.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      if (stage === "banner") {
        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd === -1) return;
        banner = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        if (!banner.startsWith("220")) {
          finish({
            ok: false,
            banner,
            error: `Expected 220 banner, got: ${banner}`,
            durationMs: 0,
          });
          return;
        }
        stage = "ehlo";
        sock.write(`EHLO ${expectedHostname}\r\n`);
        return;
      }

      if (stage === "ehlo") {
        // EHLO replies are multi-line; final line begins with "250 "
        // (space after, not dash). Wait until we see that.
        if (!/^|\r\n250 /m.test(buffer) && !buffer.startsWith("250 ")) {
          // Crude: keep waiting unless we see "250 " on a line.
          if (!/(^|\r\n)250 /.test(buffer)) return;
        }
        helo = buffer.trim();
        stage = "done";
        sock.write("QUIT\r\n");
        finish({
          ok: helo.includes("250"),
          banner,
          helo,
          durationMs: 0,
          error: helo.includes("250")
            ? undefined
            : `EHLO did not return 250: ${helo}`,
        });
        return;
      }
    });

    sock.connect(25, ip);
  });
}
