import { describe, it, expect } from 'vitest';
import { prepareEmail, type TrackingOptions } from '../email-preparer';

const BASE = 'https://app.example.com';
const TID = 'tid-123';
const HTML =
  '<html><body><p>Hi {{first_name}}</p><a href="https://example.com/link">Click</a></body></html>';

function opts(overrides: Partial<TrackingOptions> = {}): TrackingOptions {
  return {
    injectOpenPixel: false,
    rewriteClickLinks: false,
    addUnsubscribeLink: false,
    addUnsubscribeHeader: false,
    ...overrides,
  };
}

describe('prepareEmail — no-op when all flags false', () => {
  it('returns HTML and headers untouched with opts undefined', () => {
    const result = prepareEmail(HTML, TID, BASE);
    expect(result.html).toBe(HTML);
    expect(result.listUnsubscribe).toBeUndefined();
    expect(result.listUnsubscribePost).toBeUndefined();
    expect(result.applied).toEqual({
      openPixel: false,
      clickRewrite: false,
      unsubscribeLink: false,
      unsubscribeHeader: false,
    });
  });

  it('returns HTML untouched with every flag explicitly false', () => {
    const result = prepareEmail(HTML, TID, BASE, opts());
    expect(result.html).toBe(HTML);
    expect(result.html).not.toContain('api/track/open');
    expect(result.html).not.toContain('api/track/click');
    expect(result.html).not.toContain('unsubscribe');
    expect(result.listUnsubscribe).toBeUndefined();
  });
});

describe('prepareEmail — each flag injects ONLY its own piece', () => {
  it('injectOpenPixel=true adds pixel, does not rewrite links or add unsub', () => {
    const result = prepareEmail(HTML, TID, BASE, opts({ injectOpenPixel: true }));
    expect(result.html).toContain('api/track/open');
    expect(result.html).not.toContain('api/track/click');
    expect(result.html).not.toContain('/api/track/unsubscribe');
    expect(result.applied).toEqual({
      openPixel: true,
      clickRewrite: false,
      unsubscribeLink: false,
      unsubscribeHeader: false,
    });
  });

  it('rewriteClickLinks=true rewrites hrefs, does not add pixel or unsub', () => {
    const result = prepareEmail(HTML, TID, BASE, opts({ rewriteClickLinks: true }));
    expect(result.html).toContain('api/track/click');
    expect(result.html).toContain(encodeURIComponent('https://example.com/link'));
    expect(result.html).not.toContain('api/track/open');
    expect(result.html).not.toContain('/api/track/unsubscribe');
    expect(result.applied.clickRewrite).toBe(true);
    expect(result.applied.openPixel).toBe(false);
  });

  it('addUnsubscribeLink=true adds footer, no pixel or click rewrite', () => {
    const result = prepareEmail(HTML, TID, BASE, opts({ addUnsubscribeLink: true }));
    expect(result.html).toContain('/api/track/unsubscribe');
    expect(result.html).toMatch(/<a [^>]*href="[^"]*\/api\/track\/unsubscribe/);
    expect(result.html).not.toContain('api/track/open');
    expect(result.html).not.toContain('api/track/click');
    expect(result.listUnsubscribe).toBeUndefined(); // header is a SEPARATE flag
  });

  it('addUnsubscribeHeader=true sets header pair without mutating HTML', () => {
    const result = prepareEmail(HTML, TID, BASE, opts({ addUnsubscribeHeader: true }));
    expect(result.html).toBe(HTML); // HTML untouched — only headers set
    expect(result.listUnsubscribe).toBe(`<${BASE}/api/track/unsubscribe?id=${TID}>`);
    expect(result.listUnsubscribePost).toBe('List-Unsubscribe=One-Click');
  });

  it('addUnsubscribeLink + addUnsubscribeHeader are independent — can be combined', () => {
    const result = prepareEmail(HTML, TID, BASE, opts({
      addUnsubscribeLink: true,
      addUnsubscribeHeader: true,
    }));
    expect(result.html).toContain('/api/track/unsubscribe');
    expect(result.listUnsubscribe).toBeDefined();
  });
});

describe('prepareEmail — click rewrite preserves safe URLs', () => {
  it('does not rewrite mailto:, anchors, javascript:, or unsubscribe links', () => {
    const input =
      '<body><a href="mailto:x@y.com">mail</a>' +
      '<a href="#top">anchor</a>' +
      '<a href="javascript:void(0)">js</a>' +
      '<a href="/unsubscribe">unsub</a>' +
      '</body>';
    const result = prepareEmail(input, TID, BASE, opts({ rewriteClickLinks: true }));
    expect(result.html).toContain('href="mailto:x@y.com"');
    expect(result.html).toContain('href="#top"');
    expect(result.html).toContain('href="javascript:void(0)"');
    expect(result.html).toContain('href="/unsubscribe"');
  });
});
