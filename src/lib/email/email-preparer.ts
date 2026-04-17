/**
 * Email preparer — independently gated tracking injectors.
 *
 * Phase 1 change: every mutation is now an explicit opt-in. When every flag
 * is false (or opts is undefined), the HTML and returned headers are left
 * untouched — safe default for high-deliverability campaigns.
 *
 * Flags:
 *   injectOpenPixel     → 1×1 tracking pixel before </body>
 *   rewriteClickLinks   → <a href="..."> rewritten to /api/track/click
 *   addUnsubscribeLink  → footer link appended to HTML
 *   addUnsubscribeHeader→ List-Unsubscribe / List-Unsubscribe-Post headers
 *
 * The addUnsubscribeLink / addUnsubscribeHeader flags are INDEPENDENT. Dean
 * can ship a campaign that has the RFC 8058 header for deliverability mail
 * clients without inserting a visible footer, or vice-versa.
 */

export interface TrackingOptions {
  injectOpenPixel: boolean;
  rewriteClickLinks: boolean;
  addUnsubscribeLink: boolean;
  addUnsubscribeHeader: boolean;
}

export interface PreparedEmail {
  html: string;
  /** Present only when addUnsubscribeHeader is true. */
  listUnsubscribe?: string;
  /** Present only when addUnsubscribeHeader is true. */
  listUnsubscribePost?: string;
  /** Diagnostics — what the preparer actually applied. */
  applied: {
    openPixel: boolean;
    clickRewrite: boolean;
    unsubscribeLink: boolean;
    unsubscribeHeader: boolean;
  };
}

const NO_OP: TrackingOptions = {
  injectOpenPixel: false,
  rewriteClickLinks: false,
  addUnsubscribeLink: false,
  addUnsubscribeHeader: false,
};

function rewriteLinks(html: string, trackingId: string, baseUrl: string): string {
  const linkRegex = /<a\s+([^>]*?)href=["']([^"']+)["']/gi;
  return html.replace(linkRegex, (match, prefix: string, url: string) => {
    const lowerUrl = url.toLowerCase().trim();
    if (
      lowerUrl.startsWith('mailto:') ||
      lowerUrl.startsWith('#') ||
      lowerUrl.startsWith('javascript:') ||
      lowerUrl.startsWith('data:') ||
      lowerUrl.includes('unsubscribe')
    ) {
      return match;
    }
    const trackUrl = `${baseUrl}/api/track/click?id=${trackingId}&url=${encodeURIComponent(url)}`;
    return `<a ${prefix}href="${trackUrl}"`;
  });
}

function appendBeforeBody(html: string, fragment: string): string {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${fragment}</body>`);
  }
  return html + fragment;
}

export function prepareEmail(
  html: string,
  trackingId: string,
  baseUrl: string,
  opts: TrackingOptions = NO_OP
): PreparedEmail {
  let modifiedHtml = html;
  const applied = {
    openPixel: false,
    clickRewrite: false,
    unsubscribeLink: false,
    unsubscribeHeader: false,
  };

  if (opts.rewriteClickLinks) {
    modifiedHtml = rewriteLinks(modifiedHtml, trackingId, baseUrl);
    applied.clickRewrite = true;
  }

  if (opts.addUnsubscribeLink) {
    const unsubUrl = `${baseUrl}/api/track/unsubscribe?id=${trackingId}`;
    const footer = `<div style="margin-top:40px;padding-top:20px;border-top:1px solid #eee;text-align:center;font-size:11px;color:#999;"><a href="${unsubUrl}" style="color:#999;">Unsubscribe</a></div>`;
    modifiedHtml = appendBeforeBody(modifiedHtml, footer);
    applied.unsubscribeLink = true;
  }

  if (opts.injectOpenPixel) {
    const pixelUrl = `${baseUrl}/api/track/open?id=${trackingId}`;
    const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="">`;
    modifiedHtml = appendBeforeBody(modifiedHtml, pixel);
    applied.openPixel = true;
  }

  const result: PreparedEmail = { html: modifiedHtml, applied };

  if (opts.addUnsubscribeHeader) {
    const unsubUrl = `${baseUrl}/api/track/unsubscribe?id=${trackingId}`;
    result.listUnsubscribe = `<${unsubUrl}>`;
    result.listUnsubscribePost = 'List-Unsubscribe=One-Click';
    applied.unsubscribeHeader = true;
  }

  return result;
}
