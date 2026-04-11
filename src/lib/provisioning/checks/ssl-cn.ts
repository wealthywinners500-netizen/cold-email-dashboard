// ============================================
// SSL Certificate CN/Issuer/Expiry check
// ============================================
//
// Connects to host:port over TLS and inspects the leaf certificate.
// Returns subject CN, issuer, validity dates, and a flag for whether
// the cert is self-signed.
//
// We treat any cert whose issuer CN matches its subject CN as
// self-signed (the HestiaCP default before we run the LE issue),
// and we treat Let's Encrypt as the only acceptable production CA.

import { connect as tlsConnect } from "tls";

export interface SSLCertResult {
  ok: boolean;
  selfSigned: boolean;
  subjectCN?: string;
  issuerCN?: string;
  issuerO?: string;
  validFrom?: string;
  validTo?: string;
  daysUntilExpiry?: number;
  error?: string;
  durationMs: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export async function checkSSLCert(
  host: string,
  port: number = 443,
  servername?: string,
  timeoutMs: number = 15_000
): Promise<SSLCertResult> {
  const start = Date.now();

  return new Promise<SSLCertResult>((resolve) => {
    let settled = false;

    const finish = (r: SSLCertResult) => {
      if (settled) return;
      settled = true;
      resolve({ ...r, durationMs: Date.now() - start });
    };

    const sock = tlsConnect(
      {
        host,
        port,
        servername: servername || host,
        rejectUnauthorized: false, // we want to inspect bad certs too
        timeout: timeoutMs,
      },
      () => {
        try {
          const cert = sock.getPeerCertificate(true);
          if (!cert || !cert.subject) {
            finish({
              ok: false,
              selfSigned: false,
              error: "No peer certificate",
              durationMs: 0,
            });
            sock.end();
            return;
          }
          const subjectCN: string | undefined = (cert.subject as { CN?: string }).CN;
          const issuerCN: string | undefined = (cert.issuer as { CN?: string }).CN;
          const issuerO: string | undefined = (cert.issuer as { O?: string }).O;
          const validFrom = cert.valid_from;
          const validTo = cert.valid_to;
          const daysUntilExpiry = validTo
            ? Math.floor((new Date(validTo).getTime() - Date.now()) / MS_PER_DAY)
            : undefined;

          // Self-signed: subject CN equals issuer CN AND issuer O is empty/missing.
          // (HestiaCP self-signed default sets both to the hostname.)
          const selfSigned = !!(
            subjectCN &&
            issuerCN &&
            subjectCN === issuerCN &&
            (!issuerO || issuerO === subjectCN)
          );

          // OK = NOT self-signed AND not expired AND issued by Let's Encrypt
          // (the only CA we use). We are intentionally strict here because
          // a Comodo / DigiCert cert showing up would mean someone reused
          // an old hostname.
          const isLetsEncrypt =
            (issuerO || "").includes("Let's Encrypt") ||
            (issuerCN || "").startsWith("R") || // R3, R10, R11 etc.
            (issuerCN || "").startsWith("E"); // E1, E5, E6 etc.

          finish({
            ok:
              !selfSigned &&
              isLetsEncrypt &&
              (daysUntilExpiry === undefined || daysUntilExpiry > 0),
            selfSigned,
            subjectCN,
            issuerCN,
            issuerO,
            validFrom,
            validTo,
            daysUntilExpiry,
            durationMs: 0,
            error: selfSigned
              ? "Certificate is self-signed (HestiaCP default — LE issue did not run)"
              : !isLetsEncrypt
                ? `Issuer is not Let's Encrypt: ${issuerO || issuerCN}`
                : daysUntilExpiry !== undefined && daysUntilExpiry <= 0
                  ? "Certificate is expired"
                  : undefined,
          });
        } catch (err) {
          finish({
            ok: false,
            selfSigned: false,
            error: `Cert inspection failed: ${(err as Error).message}`,
            durationMs: 0,
          });
        } finally {
          try {
            sock.end();
          } catch {
            // ignore
          }
        }
      }
    );

    sock.on("error", (err) =>
      finish({
        ok: false,
        selfSigned: false,
        error: `TLS connect error: ${(err as Error).message}`,
        durationMs: 0,
      })
    );
    sock.on("timeout", () => {
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      finish({
        ok: false,
        selfSigned: false,
        error: `TLS connect timeout after ${timeoutMs}ms`,
        durationMs: 0,
      });
    });
  });
}
