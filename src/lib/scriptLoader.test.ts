/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { assertDemoScript } from './scriptLoader';

const validStep = {
  id: 'step-1',
  snapshot: { type: 0, id: 1, childNodes: [] },
  keyframes: [{ timestamp: 0, x: 0, y: 0, type: 'move' }],
  hotspots: [],
};

describe('assertDemoScript', () => {
  it('accepts a minimal valid script', () => {
    const script = { title: 'A demo', steps: [validStep] };
    expect(() => assertDemoScript(script)).not.toThrow();
  });

  it('rejects non-objects', () => {
    expect(() => assertDemoScript(null)).toThrow();
    expect(() => assertDemoScript('not a script')).toThrow();
    expect(() => assertDemoScript(42)).toThrow();
  });

  it('requires a string title', () => {
    expect(() => assertDemoScript({ steps: [validStep] })).toThrow(/title/);
    expect(() => assertDemoScript({ title: 7, steps: [validStep] })).toThrow(/title/);
  });

  it('requires a non-empty steps array', () => {
    expect(() => assertDemoScript({ title: 'A', steps: [] })).toThrow(/steps/);
    expect(() => assertDemoScript({ title: 'A' })).toThrow(/steps/);
  });

  it('rejects duplicate step ids', () => {
    expect(() =>
      assertDemoScript({
        title: 'A',
        steps: [validStep, { ...validStep }],
      }),
    ).toThrow(/duplicate step\.id/);
  });

  it('rejects steps without snapshot or html', () => {
    expect(() =>
      assertDemoScript({
        title: 'A',
        steps: [{ id: 'step-1', keyframes: [], hotspots: [] }],
      }),
    ).toThrow(/snapshot.*html/);
  });

  it('cross-checks hotspot.nextStepId against step ids', () => {
    expect(() =>
      assertDemoScript({
        title: 'A',
        steps: [
          {
            ...validStep,
            hotspots: [
              { id: 'h1', selector: '#cta', nextStepId: 'does-not-exist' },
            ],
          },
        ],
      }),
    ).toThrow(/does not match any step\.id/);
  });

  it('accepts a hotspot pointing at a valid step id', () => {
    expect(() =>
      assertDemoScript({
        title: 'A',
        steps: [
          { ...validStep, hotspots: [{ id: 'h1', selector: '#cta', nextStepId: 'step-1' }] },
        ],
      }),
    ).not.toThrow();
  });

  it('validates keyframe shape', () => {
    expect(() =>
      assertDemoScript({
        title: 'A',
        steps: [
          { ...validStep, keyframes: [{ timestamp: 0, x: 0, y: 0, type: 'wiggle' }] },
        ],
      }),
    ).toThrow(/type must be one of/);
  });

  it('validates mutation action enum', () => {
    expect(() =>
      assertDemoScript({
        title: 'A',
        steps: [
          {
            ...validStep,
            mutations: [{ selector: '#x', action: 'rewrite', value: 'hi' }],
          },
        ],
      }),
    ).toThrow(/action must be one of/);
  });
});
