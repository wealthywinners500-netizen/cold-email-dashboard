import PostalMime from 'postal-mime';
import DOMPurify from 'isomorphic-dompurify';

// email-reply-parser doesn't have types, use require
// eslint-disable-next-line @typescript-eslint/no-var-requires
let EmailReplyParser: any;
function getReplyParser() {
  if (!EmailReplyParser) {
    EmailReplyParser = require('email-reply-parser');
  }
  return EmailReplyParser;
}

export interface ParsedEmail {
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  body_preview: string | null;
  reply_only_text: string | null;
  has_attachments: boolean;
  attachment_count: number;
}

/**
 * Parse a raw email source into structured data
 * Uses postal-mime for parsing, DOMPurify for HTML sanitization,
 * and email-reply-parser for extracting visible reply text
 */
export async function parseEmail(rawSource: Buffer | Uint8Array): Promise<ParsedEmail> {
  // postal-mime parse is ASYNC — always await
  const parsed = await PostalMime.parse(rawSource);

  // Extract from
  const fromAddr = parsed.from || { address: 'unknown@unknown.com', name: '' };
  const fromEmail = typeof fromAddr === 'string' ? fromAddr : (fromAddr.address || 'unknown@unknown.com');
  const fromName = typeof fromAddr === 'string' ? null : (fromAddr.name || null);

  // Extract to
  const toEmails: string[] = [];
  if (parsed.to) {
    for (const addr of Array.isArray(parsed.to) ? parsed.to : [parsed.to]) {
      if (typeof addr === 'string') {
        toEmails.push(addr);
      } else if (addr.address) {
        toEmails.push(addr.address);
      }
    }
  }

  // Extract cc
  const ccEmails: string[] = [];
  if (parsed.cc) {
    for (const addr of Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]) {
      if (typeof addr === 'string') {
        ccEmails.push(addr);
      } else if (addr.address) {
        ccEmails.push(addr.address);
      }
    }
  }

  // Get body text
  const bodyText = parsed.text || null;

  // Sanitize HTML — CRITICAL for XSS prevention
  let bodyHtml: string | null = null;
  if (parsed.html) {
    bodyHtml = DOMPurify.sanitize(parsed.html, {
      ALLOWED_TAGS: [
        'p', 'br', 'div', 'span', 'a', 'b', 'i', 'u', 'strong', 'em',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
        'table', 'thead', 'tbody', 'tr', 'td', 'th',
        'img', 'blockquote', 'pre', 'code', 'hr',
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class', 'target', 'width', 'height'],
    });
  }

  // Extract visible reply text (strips quoted content + signatures)
  let replyOnlyText: string | null = null;
  if (bodyText) {
    try {
      const ReplyParser = getReplyParser();
      const email = new ReplyParser(bodyText);
      const visibleFragments = email.getFragments().filter((f: any) => !f.isHidden());
      replyOnlyText = visibleFragments.map((f: any) => f.getContent()).join('\n').trim() || null;
    } catch {
      replyOnlyText = bodyText; // Fallback to full text
    }
  }

  // Generate preview (first 280 chars of plain text)
  let bodyPreview: string | null = null;
  if (bodyText) {
    const cleaned = bodyText.replace(/\s+/g, ' ').trim();
    bodyPreview = cleaned.length > 280 ? cleaned.substring(0, 277) + '...' : cleaned;
  }

  // References header
  let referencesHeader: string | null = null;
  if (parsed.headers) {
    const refHeader = parsed.headers.find(
      (h: any) => h.key?.toLowerCase() === 'references'
    );
    if (refHeader) {
      referencesHeader = refHeader.value;
    }
  }

  // In-Reply-To
  let inReplyTo: string | null = null;
  if (parsed.headers) {
    const irtHeader = parsed.headers.find(
      (h: any) => h.key?.toLowerCase() === 'in-reply-to'
    );
    if (irtHeader) {
      inReplyTo = irtHeader.value?.trim() || null;
    }
  }

  return {
    message_id: parsed.messageId || null,
    in_reply_to: inReplyTo,
    references_header: referencesHeader,
    from_email: fromEmail,
    from_name: fromName,
    to_emails: toEmails,
    cc_emails: ccEmails,
    subject: parsed.subject || null,
    body_html: bodyHtml,
    body_text: bodyText,
    body_preview: bodyPreview,
    reply_only_text: replyOnlyText,
    has_attachments: (parsed.attachments?.length || 0) > 0,
    attachment_count: parsed.attachments?.length || 0,
  };
}
