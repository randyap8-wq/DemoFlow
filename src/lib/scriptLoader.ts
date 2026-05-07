/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DemoScript, DemoStep, Hotspot } from '../types';

/** Reject files larger than this when loading from disk / a remote URL. */
export const MAX_DEMO_FILE_MB = 25;
export const MAX_DEMO_FILE_BYTES = MAX_DEMO_FILE_MB * 1024 * 1024;

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
        title,
        html,
        keyframes: [],
        hotspots: [],
      },
    ],
  };
}

function fail(path: string, msg: string): never {
  throw new Error(`${path}: ${msg}`);
}

function assertHotspot(h: unknown, path: string, validStepIds: Set<string>): asserts h is Hotspot {
  if (!h || typeof h !== 'object') fail(path, 'hotspot must be an object');
  const o = h as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) fail(path, 'hotspot.id must be a non-empty string');
  if (typeof o.selector !== 'string' || !o.selector) {
    fail(path, 'hotspot.selector must be a non-empty string');
  }
  if (o.label != null && typeof o.label !== 'string') fail(path, 'hotspot.label must be a string');
  if (o.description != null && typeof o.description !== 'string') {
    fail(path, 'hotspot.description must be a string');
  }
  if (typeof o.nextStepId !== 'string' || !o.nextStepId) {
    fail(path, 'hotspot.nextStepId must be a non-empty string');
  }
  if (!validStepIds.has(o.nextStepId)) {
    fail(path, `hotspot.nextStepId "${o.nextStepId}" does not match any step.id`);
  }
}

function assertStep(step: unknown, idx: number, validStepIds: Set<string>): asserts step is DemoStep {
  const path = `steps[${idx}]`;
  if (!step || typeof step !== 'object') fail(path, 'step must be an object');
  const s = step as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id) fail(path, 'step.id must be a non-empty string');
  if (s.title != null && typeof s.title !== 'string') fail(path, 'step.title must be a string');
  if (s.description != null && typeof s.description !== 'string') {
    fail(path, 'step.description must be a string');
  }
  if (s.snapshot == null && typeof s.html !== 'string') {
    fail(path, 'step must have either "snapshot" or "html"');
  }
  if (!Array.isArray(s.keyframes)) fail(path, 'step.keyframes must be an array');
  if (!Array.isArray(s.hotspots)) fail(path, 'step.hotspots must be an array');
  for (const [i, k] of (s.keyframes as unknown[]).entries()) {
    if (!k || typeof k !== 'object') fail(`${path}.keyframes[${i}]`, 'keyframe must be an object');
    const kf = k as Record<string, unknown>;
    if (typeof kf.timestamp !== 'number') fail(`${path}.keyframes[${i}]`, 'timestamp must be a number');
    if (typeof kf.x !== 'number' || typeof kf.y !== 'number') {
      fail(`${path}.keyframes[${i}]`, 'x and y must be numbers');
    }
    if (kf.type !== 'move' && kf.type !== 'click' && kf.type !== 'wait') {
      fail(`${path}.keyframes[${i}]`, 'type must be one of "move" | "click" | "wait"');
    }
  }
  for (const [i, h] of (s.hotspots as unknown[]).entries()) {
    assertHotspot(h, `${path}.hotspots[${i}]`, validStepIds);
  }
  if (s.mutations != null) {
    if (!Array.isArray(s.mutations)) fail(path, 'step.mutations must be an array');
    for (const [i, m] of (s.mutations as unknown[]).entries()) {
      if (!m || typeof m !== 'object') fail(`${path}.mutations[${i}]`, 'mutation must be an object');
      const mu = m as Record<string, unknown>;
      if (typeof mu.selector !== 'string') fail(`${path}.mutations[${i}]`, 'selector must be a string');
      if (mu.action !== 'text' && mu.action !== 'style' && mu.action !== 'hide') {
        fail(`${path}.mutations[${i}]`, 'action must be one of "text" | "style" | "hide"');
      }
      if (typeof mu.value !== 'string') fail(`${path}.mutations[${i}]`, 'value must be a string');
    }
  }
}

/**
 * Validate that an arbitrary parsed JSON value looks enough like a
 * `DemoScript` to be safely passed to the player. Throws on failure with a
 * field-precise error path.
 */
export function assertDemoScript(value: unknown): asserts value is DemoScript {
  if (!value || typeof value !== 'object') {
    throw new Error('Demo script must be a JSON object.');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.title !== 'string') throw new Error('Demo script is missing string "title".');
  if (v.description != null && typeof v.description !== 'string') {
    throw new Error('Demo script "description" must be a string.');
  }
  if (!Array.isArray(v.steps) || v.steps.length === 0) {
    throw new Error('Demo script must have a non-empty "steps" array.');
  }

  // Collect step IDs first so hotspot.nextStepId targets can be cross-checked.
  const ids = new Set<string>();
  for (const [i, s] of (v.steps as unknown[]).entries()) {
    if (!s || typeof s !== 'object') fail(`steps[${i}]`, 'step must be an object');
    const id = (s as Record<string, unknown>).id;
    if (typeof id !== 'string' || !id) fail(`steps[${i}]`, 'step.id must be a non-empty string');
    if (ids.has(id)) fail(`steps[${i}]`, `duplicate step.id "${id}"`);
    ids.add(id);
  }

  for (const [i, s] of (v.steps as unknown[]).entries()) {
    assertStep(s, i, ids);
  }
}

/**
 * Parse the contents of a user-provided file into a DemoScript. JSON files
 * are treated as full DemoScripts; everything else is treated as raw HTML.
 */
export async function parseDemoFile(file: File): Promise<DemoScript> {
  if (file.size > MAX_DEMO_FILE_BYTES) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(
      `File "${file.name}" is ${sizeMb} MB which exceeds the ${MAX_DEMO_FILE_MB} MB limit.`,
    );
  }
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
 * Fetch and parse a DemoScript from a remote URL. Used by the `?demo=` URL
 * parameter. Honours the same size guard as local file loads.
 */
export async function loadScriptFromUrl(url: string): Promise<DemoScript> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);

  const lengthHeader = res.headers.get('content-length');
  if (lengthHeader && Number(lengthHeader) > MAX_DEMO_FILE_BYTES) {
    throw new Error(`Remote file exceeds ${MAX_DEMO_FILE_MB} MB limit.`);
  }
  // Read as bytes and decode to text ourselves so the size guard is enforced
  // in real bytes. `string.length` counts UTF-16 code units, which can let
  // multi-byte payloads slip past or reject smaller-than-limit files.
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_DEMO_FILE_BYTES) {
    throw new Error(`Remote file exceeds ${MAX_DEMO_FILE_MB} MB limit.`);
  }
  const body = new TextDecoder().decode(buffer);

  const ct = res.headers.get('content-type') || '';
  const looksJson = ct.includes('json') || url.toLowerCase().endsWith('.json') || body.trimStart().startsWith('{');
  if (looksJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new Error(`Invalid JSON at ${url}: ${(err as Error).message}`);
    }
    assertDemoScript(parsed);
    return parsed;
  }
  return htmlToDemoScript(body, url);
}

/**
 * Serialize a DemoScript to a pretty-printed JSON string suitable for
 * downloading.
 */
export function exportScriptAsJson(script: DemoScript): string {
  return JSON.stringify(script, null, 2);
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
