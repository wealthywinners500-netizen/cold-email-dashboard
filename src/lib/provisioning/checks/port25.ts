/**
 * Port 25 connectivity check — verifies SMTP banner, STARTTLS, hostname match, open relay.
 * Used by the VG serverless step in serverless-steps.ts.
 */

import * as net from "net";
import * as tls from "tls";

export interface Port25Result {
  ok: boolean;
  banner?: string;
  starttls?: boolean;
  bannerHostnameMatch?: boolean;
  openRelay?: boolean;
  error?: string;
}

export async function checkPort25(
  ip: string,
  expectedHostname: string
): Promise<Port25Result> {
  return new Promise((resolve) => {
    const timeout = 15000;
    const socket = net.createConnection({ host: ip, port: 25, timeout });
    let banner = "";
    let resolved = false;

    const finish = (result: Port25Result) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(result);
    };

    socket.on("timeout", () => finish({ ok: false, error: "Connection timed out" }));
    socket.on("error", (err) => finish({ ok: false, error: err.message }));

    socket.on("data", (data) => {
      banner += data.toString();
      if (banner.includes("\n") || banner.length > 512) {
        const firstLine = banner.split("\n")[0].trim();
        const bannerHostnameMatch = firstLine.toLowerCase().includes(expectedHostname.toLowerCase());

        // Check STARTTLS support
        socket.write("EHLO check.local\r\n");
        let ehloResponse = "";

        const onEhloData = (chunk: Buffer) => {
          ehloResponse += chunk.toString();
          if (ehloResponse.includes("250 ") || ehloResponse.length > 2048) {
            socket.removeListener("data", onEhloData);
            const starttls = ehloResponse.toUpperCase().includes("STARTTLS");

            // Simple open relay check: try MAIL FROM with external domain
            socket.write("MAIL FROM:<test@external-check.example.com>\r\n");
            let mailResponse = "";

            const onMailData = (chunk2: Buffer) => {
              mailResponse += chunk2.toString();
              if (mailResponse.includes("\n") || mailResponse.length > 512) {
                socket.removeListener("data", onMailData);
                const mailAccepted = mailResponse.startsWith("250");

                if (mailAccepted) {
                  // Try RCPT TO with external domain
                  socket.write("RCPT TO:<test@gmail.com>\r\n");
                  let rcptResponse = "";

                  const onRcptData = (chunk3: Buffer) => {
                    rcptResponse += chunk3.toString();
                    if (rcptResponse.includes("\n") || rcptResponse.length > 512) {
                      socket.removeListener("data", onRcptData);
                      const openRelay = rcptResponse.startsWith("250");
                      finish({
                        ok: true,
                        banner: firstLine,
                        starttls,
                        bannerHostnameMatch,
                        openRelay,
                      });
                    }
                  };
                  socket.on("data", onRcptData);
                } else {
                  finish({
                    ok: true,
                    banner: firstLine,
                    starttls,
                    bannerHostnameMatch,
                    openRelay: false,
                  });
                }
              }
            };
            socket.on("data", onMailData);
          }
        };
        socket.removeAllListeners("data");
        socket.on("data", onEhloData);
      }
    });

    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        finish({
          ok: banner.length > 0,
          banner: banner.split("\n")[0].trim() || undefined,
          starttls: undefined,
          bannerHostnameMatch: undefined,
          openRelay: undefined,
          error: banner.length > 0 ? undefined : "No banner received within timeout",
        });
      }
    }, timeout);
  });
}
