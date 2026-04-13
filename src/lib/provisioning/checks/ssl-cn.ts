/**
 * SSL certificate CN/SAN check — verifies certificate exists, matches expected hostname,
 * and reports expiry info. Used by VG serverless step in serverless-steps.ts.
 */

import * as tls from "tls";

export interface SSLCertResult {
  ok: boolean;
  subjectCN?: string;
  issuerCN?: string;
  issuerO?: string;
  daysUntilExpiry?: number;
  error?: string;
}

export async function checkSSLCert(
  hostname: string,
  port: number,
  expectedCN: string
): Promise<SSLCertResult> {
  return new Promise((resolve) => {
    const timeout = 10000;
    let resolved = false;

    const finish = (result: SSLCertResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    try {
      const socket = tls.connect(
        {
          host: hostname,
          port,
          servername: expectedCN,
          rejectUnauthorized: false,
          timeout,
        },
        () => {
          try {
            const cert = socket.getPeerCertificate();
            if (!cert || !cert.subject) {
              finish({ ok: false, error: "No certificate presented" });
              socket.destroy();
              return;
            }

            const rawCN = cert.subject.CN;
            const subjectCN = Array.isArray(rawCN) ? rawCN[0] || "" : rawCN || "";
            const rawIssuerCN = cert.issuer?.CN;
            const issuerCN = Array.isArray(rawIssuerCN) ? rawIssuerCN[0] || "" : rawIssuerCN || "";
            const rawIssuerO = cert.issuer?.O;
            const issuerO = Array.isArray(rawIssuerO) ? rawIssuerO[0] || "" : rawIssuerO || "";
            const validTo = new Date(cert.valid_to);
            const daysUntilExpiry = Math.floor(
              (validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );

            // Check if CN or SAN matches expected
            const sans = (cert.subjectaltname || "")
              .split(",")
              .map((s: string) => s.trim().replace(/^DNS:/, "").toLowerCase());
            const cnMatch =
              subjectCN.toLowerCase() === expectedCN.toLowerCase() ||
              sans.includes(expectedCN.toLowerCase());

            if (cnMatch && daysUntilExpiry > 0) {
              finish({
                ok: true,
                subjectCN,
                issuerCN,
                issuerO,
                daysUntilExpiry,
              });
            } else if (daysUntilExpiry <= 0) {
              finish({
                ok: false,
                subjectCN,
                issuerCN,
                issuerO,
                daysUntilExpiry,
                error: `Certificate expired ${Math.abs(daysUntilExpiry)} days ago`,
              });
            } else {
              finish({
                ok: false,
                subjectCN,
                issuerCN,
                issuerO,
                daysUntilExpiry,
                error: `CN mismatch: expected ${expectedCN}, got ${subjectCN} (SANs: ${sans.join(", ")})`,
              });
            }
          } catch (err) {
            finish({
              ok: false,
              error: `Certificate parse error: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
          socket.destroy();
        }
      );

      socket.on("error", (err) => {
        finish({ ok: false, error: `TLS connection error: ${err.message}` });
      });

      socket.on("timeout", () => {
        finish({ ok: false, error: "TLS connection timed out" });
        socket.destroy();
      });
    } catch (err) {
      finish({
        ok: false,
        error: `SSL check failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}
