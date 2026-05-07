/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { rebuild } from 'rrweb-snapshot';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BASE_IFRAME_STYLE = `
  html, body {
    margin: 0;
    padding: 0;
    overflow: hidden;
    width: 100%;
    height: 100%;
    pointer-events: none; /* Disable native interactions by default */
  }
  img { max-width: 100%; }
`;

/**
 * Rebuild an rrweb-snapshot serialized DOM tree inside the given iframe.
 * Returns a Promise that resolves once the iframe document is ready for
 * querying (mutations, hotspot positioning, etc.).
 */
export function injectSnapshotIntoIframe(
  iframe: HTMLIFrameElement,
  snapshot: any,
): Promise<void> {
  return new Promise((resolve) => {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      resolve();
      return;
    }

    // Reset any prior srcdoc so doc.write takes over cleanly.
    if (iframe.getAttribute('srcdoc')) {
      iframe.removeAttribute('srcdoc');
    }

    doc.open();
    doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
    doc.close();

    rebuild(snapshot, { doc } as any);

    const style = doc.createElement('style');
    style.textContent = BASE_IFRAME_STYLE;
    doc.head.appendChild(style);

    // Resolve on next frame so layout is ready for downstream queries.
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Strip `<script>` blocks, `<noscript>` blocks, `on*` inline event handlers
 * and `javascript:` URLs from a raw HTML string. The iframe sandbox already
 * blocks script execution (it does not include `allow-scripts`), but this
 * is a belt-and-braces measure so that, even if a future change relaxes
 * the sandbox, attacker-controlled markup still can't run code.
 *
 * Implemented with `DOMParser` so the browser's real HTML parser handles
 * the long tail of sneaky markup variants (whitespace inside end tags,
 * mixed-case attributes, attribute-value bypasses, etc.). DemoFlow is a
 * browser app — `injectHtmlIntoIframe` requires an `HTMLIFrameElement`,
 * so DOMParser is always available at the call site.
 */
export function sanitizeRawHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Drop every <script> and <noscript> regardless of nesting.
  doc.querySelectorAll('script, noscript').forEach((n) => n.remove());

  // Strip on* inline handlers and neutralise javascript: URLs.
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;
  while (node) {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === 'href' || name === 'src' || name === 'xlink:href') &&
        /^\s*javascript:/i.test(attr.value)
      ) {
        node.setAttribute(attr.name, '#');
      }
    }
    node = walker.nextNode() as Element | null;
  }

  // For full documents, return the parsed `<html>` tree (with a doctype so
  // the iframe doesn't drop into quirks mode). For body fragments, return
  // just the body's inner HTML so the caller can wrap it however it likes.
  const looksLikeFullDoc = /^\s*<!doctype/i.test(html) || /<html[\s>]/i.test(html);
  if (looksLikeFullDoc && doc.documentElement) {
    return `<!doctype html>${doc.documentElement.outerHTML}`;
  }
  return doc.body.innerHTML;
}

/**
 * Inject a raw HTML string into the iframe via `srcdoc`. This is the
 * recommended path for large local pages: the browser parses the document
 * off the main React render path, and we get clean isolation without
 * round-tripping through `rrweb-snapshot`.
 *
 * Returns a Promise that resolves on the iframe's `load` event.
 */
export function injectHtmlIntoIframe(
  iframe: HTMLIFrameElement,
  html: string,
): Promise<void> {
  return new Promise((resolve) => {
    const sanitized = sanitizeRawHtml(html);
    const styleTag = `<style data-demoflow-base>${BASE_IFRAME_STYLE}</style>`;
    let doc: string;

    if (/<\/head\s*>/i.test(sanitized)) {
      doc = sanitized.replace(/<\/head\s*>/i, `${styleTag}</head>`);
    } else if (/<html[\s>]/i.test(sanitized)) {
      doc = sanitized.replace(/<html([^>]*)>/i, `<html$1><head>${styleTag}</head>`);
    } else {
      // Fragment / partial HTML
      doc = `<!doctype html><html><head>${styleTag}</head><body>${sanitized}</body></html>`;
    }

    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      resolve();
    };
    iframe.addEventListener('load', onLoad);
    iframe.srcdoc = doc;
  });
}
