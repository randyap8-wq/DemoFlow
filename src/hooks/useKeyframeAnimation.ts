/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { DemoStep, Keyframe } from '../types';

interface CursorPos {
  x: number;
  y: number;
}

interface KeyframeAnimationOptions {
  /** Step whose `keyframes` should be played. */
  step: DemoStep | undefined;
  /** Whether playback is currently active. */
  isPlaying: boolean;
  /** Playback rate multiplier (1 = real time). */
  speed: number;
  /** Honour `prefers-reduced-motion` by jumping straight to the last frame. */
  reducedMotion: boolean;
  /** Receives the interpolated cursor position each frame. */
  onCursorChange: (pos: CursorPos) => void;
  /** Toggled true while the cursor is "landing" on a click keyframe. */
  onClickingChange: (isClicking: boolean) => void;
  /** 0–100 progress percentage along the step's keyframe timeline. */
  onProgressChange: (pct: number) => void;
  /** Called when playback completes (end of keyframes / reduced-motion jump). */
  onComplete: () => void;
}

/**
 * Drives the per-step keyframe animation with `requestAnimationFrame`. Lives
 * outside `DemoPlayer` so the rAF loop can be reasoned about (and unit-tested
 * in the future) without dragging in the rest of the player's iframe / hotspot
 * state. The hook owns the playhead and last-frame timestamps via refs;
 * callers receive interpolated cursor / click / progress updates through the
 * supplied callbacks.
 *
 * Returns the playhead ref (in milliseconds) so the caller can render a
 * timecode without re-rendering on every frame.
 */
export function useKeyframeAnimation({
  step,
  isPlaying,
  speed,
  reducedMotion,
  onCursorChange,
  onClickingChange,
  onProgressChange,
  onComplete,
}: KeyframeAnimationOptions): { playheadRef: MutableRefObject<number> } {
  const playheadRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);

  // Reset the playhead whenever the step identity changes so a new step
  // starts from t=0 even if the previous step was mid-playback.
  useEffect(() => {
    playheadRef.current = 0;
    lastUpdateRef.current = 0;
  }, [step]);

  useEffect(() => {
    if (!isPlaying || !step) return;

    const keyframes: Keyframe[] = step.keyframes;
    const totalDuration = keyframes[keyframes.length - 1]?.timestamp || 0;
    if (!keyframes.length || totalDuration <= 0) {
      onComplete();
      return;
    }

    // Reduced-motion: jump straight to the final keyframe instead of
    // animating between them. We still drive the progress bar so users
    // can see playback completed.
    if (reducedMotion) {
      const last = keyframes[keyframes.length - 1];
      onCursorChange({ x: last.x, y: last.y });
      // Keep the time readout consistent with the progress bar — without
      // this the timecode stays at 00:00 even though we just "completed"
      // playback. Also clear any in-flight click state.
      playheadRef.current = totalDuration;
      onClickingChange(false);
      onProgressChange(100);
      onComplete();
      return;
    }

    const animate = (time: number) => {
      if (!lastUpdateRef.current) lastUpdateRef.current = time;
      // Scale wall-clock delta by `speed` so 2× advances the playhead twice
      // as fast and 0.5× advances half as fast. Keyframe timestamps stay
      // unchanged; only the rate at which we walk through them changes.
      //
      // Clamp the per-frame delta before applying speed: when a tab is
      // backgrounded the browser throttles `requestAnimationFrame` (often to
      // ~1 Hz) and the first callback after returning can carry a multi-
      // second wall-clock delta. Without clamping the playhead would jump
      // forward past several keyframes — including any `click` keyframes —
      // and the rendered cursor + click ripple would skip them entirely.
      // 100ms is roughly six frames at 60 fps, which keeps normal playback
      // feeling continuous while preventing the "skip everything" jump.
      const rawDelta = time - lastUpdateRef.current;
      const clampedDelta = Math.min(rawDelta, 100);
      const deltaTime = clampedDelta * speed;
      lastUpdateRef.current = time;

      playheadRef.current += deltaTime;

      if (playheadRef.current >= totalDuration) {
        onProgressChange(100);
        onComplete();
        return;
      }

      onProgressChange((playheadRef.current / totalDuration) * 100);

      const nextIdx = keyframes.findIndex((k) => k.timestamp > playheadRef.current);
      const prevIdx = nextIdx > 0 ? nextIdx - 1 : 0;

      const prev = keyframes[prevIdx];
      const next = keyframes[nextIdx];

      if (prev && next) {
        const segmentProgress =
          (playheadRef.current - prev.timestamp) / (next.timestamp - prev.timestamp);
        onCursorChange({
          x: prev.x + (next.x - prev.x) * segmentProgress,
          y: prev.y + (next.y - prev.y) * segmentProgress,
        });
        onClickingChange(next.type === 'click' && segmentProgress > 0.9);
      }

      requestAnimationFrame(animate);
    };

    const requestId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(requestId);
      lastUpdateRef.current = 0;
    };
  }, [
    isPlaying,
    step,
    speed,
    reducedMotion,
    onCursorChange,
    onClickingChange,
    onProgressChange,
    onComplete,
  ]);

  return { playheadRef };
}
