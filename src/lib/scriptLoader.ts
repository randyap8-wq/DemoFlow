/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DemoScript } from '../types';

/**
 * Wrap a raw HTML document into a minimal single-step DemoScript so the
 * existing player can render it with no keyframes / hotspots.
 */
export function htmlToDemoScript(html: string, title = 'Local HTML'): DemoScript {
  return {
    title,
    description: 'Loaded from a local HTML file.',
    steps: [
      {
        id: 'html-step-1',
        html,
        keyframes: [],
        hotspots: [],
      },
    ],
  };
}

/**
 * Validate that an arbitrary parsed JSON value looks enough like a
 * `DemoScript` to be safely passed to the player. Throws on failure.
 */
export function assertDemoScript(value: unknown): asserts value is DemoScript {
  if (!value || typeof value !== 'object') {
    throw new Error('Demo script must be a JSON object.');
  }
  const v = value as Partial<DemoScript>;
  if (typeof v.title !== 'string') {
    throw new Error('Demo script is missing a string "title".');
  }
  if (!Array.isArray(v.steps) || v.steps.length === 0) {
    throw new Error('Demo script must have a non-empty "steps" array.');
  }
  for (const [i, step] of v.steps.entries()) {
    if (!step || typeof step !== 'object') {
      throw new Error(`Step ${i} is not an object.`);
    }
    const s = step as unknown as Record<string, unknown>;
    if (typeof s.id !== 'string') {
      throw new Error(`Step ${i} is missing string "id".`);
    }
    if (s.snapshot == null && typeof s.html !== 'string') {
      throw new Error(`Step ${i} must have either "snapshot" or "html".`);
    }
    if (!Array.isArray(s.keyframes)) {
      throw new Error(`Step ${i} is missing "keyframes" array.`);
    }
    if (!Array.isArray(s.hotspots)) {
      throw new Error(`Step ${i} is missing "hotspots" array.`);
    }
  }
}

/**
 * Parse the contents of a user-provided file into a DemoScript. JSON files
 * are treated as full DemoScripts; everything else is treated as raw HTML.
 */
export async function parseDemoFile(file: File): Promise<DemoScript> {
  const text = await file.text();
  const lower = file.name.toLowerCase();
  const isJson = lower.endsWith('.json') || file.type === 'application/json';

  if (isJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`Invalid JSON in ${file.name}: ${(err as Error).message}`);
    }
    assertDemoScript(parsed);
    return parsed;
  }

  return htmlToDemoScript(text, file.name);
}

/**
 * On startup, try to load a script from the local `public/` directory so
 * that large demos do not have to be bundled into the JS payload. Returns
 * `null` when no local file is found, in which case callers should fall
 * back to the bundled sample.
 */
export async function loadScriptFromPublic(): Promise<DemoScript | null> {
  // Try JSON first, then HTML, both relative to the app root.
  try {
    const res = await fetch('demo.json', { cache: 'no-store' });
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      const body = await res.text();
      // Guard against dev servers serving index.html as a fallback.
      if (ct.includes('json') || body.trimStart().startsWith('{')) {
        const parsed = JSON.parse(body);
        assertDemoScript(parsed);
        return parsed;
      }
    }
  } catch {
    // ignore, fall through
  }

  try {
    const res = await fetch('demo.html', { cache: 'no-store' });
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      const body = await res.text();
      if (ct.includes('html') || /<html[\s>]/i.test(body)) {
        return htmlToDemoScript(body, 'demo.html');
      }
    }
  } catch {
    // ignore
  }

  return null;
}
