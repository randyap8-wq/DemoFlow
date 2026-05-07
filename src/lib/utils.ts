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

export function injectSnapshotIntoIframe(iframe: HTMLIFrameElement, snapshot: any) {
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) return;

  // Clear existing content
  doc.open();
  doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
  doc.close();

  // Rebuild the snapshot
  rebuild(snapshot, {
    doc,
    onNodeCreated: (node) => {
      // Custom hooks if needed for mutations
    }
  });

  // Inject some base styles for the demo to handle sizing
  const style = doc.createElement('style');
  style.textContent = `
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
  doc.head.appendChild(style);
}
