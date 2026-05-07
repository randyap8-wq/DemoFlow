/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { sanitizeRawHtml } from './utils';

describe('sanitizeRawHtml', () => {
  it('strips <script> tags', () => {
    const out = sanitizeRawHtml('<div>hi</div><script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('hi');
  });

  it('strips <noscript> tags', () => {
    const out = sanitizeRawHtml('<div>hi</div><noscript>fallback</noscript>');
    expect(out).not.toMatch(/<noscript/i);
  });

  it('strips on* inline event handlers', () => {
    const out = sanitizeRawHtml('<button onclick="alert(1)" onmouseover="x()">go</button>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/onmouseover/i);
    expect(out).toContain('go');
  });

  it('neutralises javascript: URLs in href/src/xlink:href', () => {
    const out = sanitizeRawHtml(
      '<a href="javascript:alert(1)">x</a><img src="javascript:alert(2)"><svg><use xlink:href="javascript:bad()"/></svg>',
    );
    expect(out).not.toMatch(/javascript:/i);
    // The neutralised links are rewritten to '#'
    expect(out).toMatch(/href="#"/);
  });

  it('preserves benign attributes', () => {
    const out = sanitizeRawHtml('<a href="https://example.com" class="cta">link</a>');
    expect(out).toContain('https://example.com');
    expect(out).toContain('class="cta"');
  });

  it('returns body inner HTML for fragments', () => {
    const out = sanitizeRawHtml('<p>hello</p>');
    expect(out.toLowerCase()).not.toContain('<html');
    expect(out).toContain('<p>hello</p>');
  });

  it('returns full document with doctype when given a full document', () => {
    const out = sanitizeRawHtml(
      '<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>',
    );
    expect(out.toLowerCase()).toContain('<!doctype html>');
    expect(out.toLowerCase()).toContain('<html');
  });
});
