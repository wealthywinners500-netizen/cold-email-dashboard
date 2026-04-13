// ============================================
// Port 25 reachability + SMTP banner/STARTTLS/relay check
// ============================================
//
// Connects to <ip>:25 and reads the SMTP greeting + EHLO response.
// Used by verification_gate to confirm a freshly-provisioned mail
// server is actually reachable from the worker VPS (which is the
// network vantage point that matters — not from Vercel serverless,
// which has port 25 egress blocked by GCP/AWS).
//
// Checks:
//   1. 220 banner greeting present
//   2. EHLO returns 250
//   3. STARTTLS offered in EHLO capabilities
//   4. Banner hostname matches expected hostname
//   5. Open relay test (MAIL FROM + RCPT TO external address)
//
// Returns a structured Port25Result with individual check outcomes.

import { Socket } from "net";

export interface Port25Result {
  ok: boolean;
  banner?: string;
  helo?: string;
  starttls: boolean;
  bannerHostnameMatch: boolean;
  openRelay: boolean; // true = BAD (server is an open relay)
  error?: string;
  durationMs: number;
}

/**
 * Read from socket until we see the final line of a multi-line SMTP response.
 * Multi-line responses have "CODE-" prefix; the final line has "CODE " (space).
 * Returns the full accumulated response or null on timeout.
 */
function readSmtpResponse(
  sock: Socket,
  existingBuffer: string,
  timeoutMs: number
): Promise<{ response: string; remainder: string } | null> {
  return new Promise((resolve) => {
    let buffer = existingBuffer;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      sock.removeListener("data", onData);
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      // Check for final line: starts with 3-digit code + space
      const lines = buffer.split("\r\n");
      for (let i = 0; i < lines.length; i++) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          // Found final line — everything up to and including this line is the response
          const responseLines = lines.slice(0, i + 1);
          const remainderLines = lines.slice(i + 1);
          cleanup();
          resolve({
            response: responseLines.join("\r\n"),
            remainder: remainderLines.join("\r\n"),
          });
          return;
        }
      }
      // Also handle single-line responses without trailing \r\n yet
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(null); // timeout
    }, timeoutMs);

    sock.on("data", onData);

    // Check existing buffer immediately
    if (buffer) {
      const fakeChunk = Buffer.from("");
      onData(fakeChunk);
    }
  });
}

export async function checkPort25(
  ip: string,
  expectedHostname: string,
  timeoutMs: number = 15_000
): Promise<Port25Result> {
  const start = Date.now();
  const perStageTimeout = Math.min(timeoutMs, 10_000);

  return new Promise<Port25Result>((resolve) => {
    const sock = new Socket();
    let settled = false;

    const finish = (r: Omit<Port25Result, "durationMs">) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve({ ...r, durationMs: Date.now() - start } as Port25Result);
    };

    sock.setTimeout(timeoutMs);
    sock.once("timeout", () =>
      finish({
        ok: false,
        starttls: false,
        bannerHostnameMatch: false,
        openRelay: false,
        error: `Port 25 timed out after ${timeoutMs}ms`,
      })
    );
    sock.once("error", (err) =>
      finish({
        ok: false,
        starttls: false,
        bannerHostnameMatch: false,
        openRelay: false,
        error: `Port 25 socket error: ${(err as Error).message}`,
      })
    );

    sock.once("connect", async () => {
      try {
        let remainder = "";

        // Stage 1: Read 220 banner
        const bannerResp = await readSmtpResponse(sock, remainder, perStageTimeout);
        if (!bannerResp) {
          finish({
            ok: false,
            starttls: false,
            bannerHostnameMatch: false,
            openRelay: false,
            error: "Timeout waiting for 220 banner",
          });
          return;
        }
        const banner = bannerResp.response;
        remainder = bannerResp.remainder;

        if (!banner.startsWith("220")) {
          finish({
            ok: false,
            banner,
            starttls: false,
            bannerHostnameMatch: false,
            openRelay: false,
            error: `Expected 220 banner, got: ${banner}`,
          });
          return;
        }

        // Check banner hostname match (case-insensitive)
        const bannerHostnameMatch = banner
          .toLowerCase()
          .includes(expectedHostname.toLowerCase());

        // Stage 2: Send EHLO, read response
        sock.write(`EHLO ${expectedHostname}\r\n`);
        const ehloResp = await readSmtpResponse(sock, remainder, perStageTimeout);
        if (!ehloResp) {
          finish({
            ok: false,
            banner,
            bannerHostnameMatch,
            starttls: false,
            openRelay: false,
            error: "Timeout waiting for EHLO response",
          });
          return;
        }
        const helo = ehloResp.response;
        remainder = ehloResp.remainder;

        if (!helo.includes("250")) {
          finish({
            ok: false,
            banner,
            helo,
            bannerHostnameMatch,
            starttls: false,
            openRelay: false,
            error: `EHLO did not return 250: ${helo}`,
          });
          return;
        }

        // Check STARTTLS in EHLO capabilities
        const starttls =
          helo.toUpperCase().includes("250-STARTTLS") ||
          helo.toUpperCase().includes("250 STARTTLS");

        // Stage 3: Open relay test
        // Send MAIL FROM with a test address
        let openRelay = false;
        try {
          sock.write(`MAIL FROM:<test@test.com>\r\n`);
          const mailResp = await readSmtpResponse(sock, remainder, perStageTimeout);
          if (mailResp && mailResp.response.startsWith("250")) {
            remainder = mailResp.remainder;
            // Server accepted MAIL FROM — now try RCPT TO external address
            sock.write(`RCPT TO:<test@example.com>\r\n`);
            const rcptResp = await readSmtpResponse(
              sock,
              remainder,
              perStageTimeout
            );
            if (rcptResp) {
              remainder = rcptResp.remainder;
              // If server accepts RCPT TO an external domain, it's an open relay
              if (rcptResp.response.startsWith("250")) {
                openRelay = true;
              }
              // 550, 553, 454, 550, etc. = good, relay denied
            }
          }
          // If MAIL FROM was rejected, relay test is inconclusive but not an open relay
        } catch {
          // Relay test error — not an open relay indicator
        }

        // Stage 4: Clean up — RSET then QUIT
        try {
          sock.write(`RSET\r\n`);
          await readSmtpResponse(sock, remainder, 3000);
          sock.write(`QUIT\r\n`);
        } catch {
          // ignore cleanup errors
        }

        finish({
          ok: helo.includes("250"),
          banner,
          helo,
          starttls,
          bannerHostnameMatch,
          openRelay,
        });
      } catch (err) {
        finish({
          ok: false,
          starttls: false,
          bannerHostnameMatch: false,
          openRelay: false,
          error: `SMTP check error: ${(err as Error).message}`,
        });
      }
    });

    sock.connect(25, ip);
  });
}
