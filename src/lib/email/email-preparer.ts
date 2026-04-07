/**
 * B10: Email Preparer
 * Injects open tracking pixel, rewrites click URLs, adds unsubscribe link/headers.
 */

interface PreparedEmail {
  html: string;
  listUnsubscribe: string;
  listUnsubscribePost: string;
}

/**
 * Prepare an email for tracking by injecting pixel, rewriting links, adding unsub.
 */
export function prepareEmail(
  html: string,
  trackingId: string,
  baseUrl: string
): PreparedEmail {
  let modifiedHtml = html;

  // 1. Rewrite <a href="..."> links for click tracking
  // SKIP: mailto:, #anchors, unsubscribe links, javascript:, data:
  const linkRegex = /<a\s+([^>]*?)href=["']([^"']+)["']/gi;
  modifiedHtml = modifiedHtml.replace(linkRegex, (match, prefix, url) => {
    const lowerUrl = url.toLowerCase().trim();

    // Skip non-trackable URLs
    if (
      lowerUrl.startsWith("mailto:") ||
      lowerUrl.startsWith("#") ||
      lowerUrl.startsWith("javascript:") ||
      lowerUrl.startsWith("data:") ||
      lowerUrl.includes("unsubscribe")
    ) {
      return match;
    }

    const trackUrl = `${baseUrl}/api/track/click?id=${trackingId}&url=${encodeURIComponent(url)}`;
    return `<a ${prefix}href="${trackUrl}"`;
  });

  // 2. Add unsubscribe footer
  const unsubUrl = `${baseUrl}/api/track/unsubscribe?id=${trackingId}`;
  const unsubFooter = `<div style="margin-top:40px;padding-top:20px;border-top:1px solid #eee;text-align:center;font-size:11px;color:#999;"><a href="${unsubUrl}" style="color:#999;">Unsubscribe</a></div>`;

  // Insert before </body> if present, otherwise append
  if (modifiedHtml.toLowerCase().includes("</body>")) {
    modifiedHtml = modifiedHtml.replace(
      /<\/body>/i,
      `${unsubFooter}</body>`
    );
  } else {
    modifiedHtml += unsubFooter;
  }

  // 3. Inject open tracking pixel before </body>
  const pixelUrl = `${baseUrl}/api/track/open?id=${trackingId}`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="">`;

  if (modifiedHtml.toLowerCase().includes("</body>")) {
    modifiedHtml = modifiedHtml.replace(/<\/body>/i, `${pixel}</body>`);
  } else {
    modifiedHtml += pixel;
  }

  // 4. Build List-Unsubscribe headers (RFC 8058)
  const listUnsubscribe = `<${unsubUrl}>`;
  const listUnsubscribePost = "List-Unsubscribe=One-Click";

  return {
    html: modifiedHtml,
    listUnsubscribe,
    listUnsubscribePost,
  };
}
