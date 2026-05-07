/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DemoScript, DemoStep, Hotspot } from '../types';
import { injectHtmlIntoIframe, injectSnapshotIntoIframe } from '../lib/utils';
import { useKeyframeAnimation } from '../hooks/useKeyframeAnimation';
import { VirtualCursor } from './VirtualCursor';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

interface DemoPlayerProps {
  script: DemoScript;
  /** Optional initial step (id or zero-based index). Used for deep links. */
  initialStep?: string | number;
  /** Hide the chrome around the iframe — useful for `?embed=1` mode. */
  embed?: boolean;
  /** Notified each time the player advances to a new step. */
  onStepChange?: (info: { stepId: string; index: number; total: number }) => void;
}

/** Imperative handle exposed to parents (used by App for postMessage API). */
export interface DemoPlayerHandle {
  play: () => void;
  pause: () => void;
  goToStep: (target: string | number) => boolean;
  next: () => void;
  prev: () => void;
  restart: () => void;
  getState: () => { stepId: string; index: number; total: number; isPlaying: boolean };
}

type HotspotPosition = { top: string; left: string };

const PLAYBACK_SPEEDS = [0.5, 1, 2] as const;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);
  return reduced;
}

function resolveStepIndex(script: DemoScript, target: string | number | undefined): number {
  if (target == null) return 0;
  if (typeof target === 'number') {
    // Reject non-integer / out-of-range indices outright. Returning a clamped
    // or fractional index would leave `currentStep` undefined or pointing at
    // the wrong step for deep links like `#step=1.5`.
    if (Number.isInteger(target) && target >= 0 && target < script.steps.length) return target;
    return 0;
  }
  const numeric = Number(target);
  if (!Number.isNaN(numeric) && String(numeric) === target) {
    if (Number.isInteger(numeric) && numeric >= 0 && numeric < script.steps.length) return numeric;
  }
  const byId = script.steps.findIndex((s) => s.id === target);
  return byId === -1 ? 0 : byId;
}

export const DemoPlayer = forwardRef<DemoPlayerHandle, DemoPlayerProps>(function DemoPlayer(
  { script, initialStep, embed = false, onStepChange },
  ref,
) {
  const [currentStepIndex, setCurrentStepIndex] = useState(() => resolveStepIndex(script, initialStep));
  const [isPlaying, setIsPlaying] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 });
  const [isClicking, setIsClicking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hotspotPositions, setHotspotPositions] = useState<Record<string, HotspotPosition>>({});
  const [speed, setSpeed] = useState<number>(1);
  // Set when the iframe becomes inaccessible (typically because a remote
  // ?demo=<url> caused us to load a cross-origin document and the browser
  // now blocks contentDocument access). We surface this as a banner instead
  // of silently rendering a player with no hotspots.
  const [iframeAccessError, setIframeAccessError] = useState<string | null>(null);

  const reducedMotion = usePrefersReducedMotion();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Per-inject cache of querySelector results to avoid repeat traversal
  // of large DOMs across mutations and hotspot positioning.
  const selectorCacheRef = useRef<Map<string, Element | null>>(new Map());

  // Reset to first step whenever the script identity changes (e.g. after a
  // file load) so we never index past the end of `script.steps`.
  useEffect(() => {
    setCurrentStepIndex(resolveStepIndex(script, initialStep));
    setIsPlaying(false);
    setProgress(0);
    // We intentionally don't depend on `initialStep` here — that would
    // re-jump the player every time the parent prop changed (e.g. as the
    // user navigates). The parent uses the imperative handle for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script]);

  const safeStepIndex = Math.min(currentStepIndex, Math.max(script.steps.length - 1, 0));
  const currentStep = script.steps[safeStepIndex];

  // Notify parent of step changes.
  useEffect(() => {
    if (!currentStep) return;
    onStepChange?.({ stepId: currentStep.id, index: safeStepIndex, total: script.steps.length });
  }, [currentStep, safeStepIndex, script.steps.length, onStepChange]);

  const queryCached = (selector: string): Element | null => {
    const cache = selectorCacheRef.current;
    if (cache.has(selector)) return cache.get(selector) ?? null;
    let doc: Document | null | undefined;
    try {
      doc = iframeRef.current?.contentDocument;
    } catch {
      // Cross-origin iframe — accessing contentDocument throws a
      // SecurityError. Surface it once (gating on existing state to avoid
      // re-render loops when this is hit for every mutation/hotspot in a
      // step) and bail out so we don't keep trying to query a document we
      // can't read.
      setIframeAccessError((prev) =>
        prev ??
        'Cannot access iframe content because the demo is on a different origin (loaded via ?demo=<url>). Hotspots and mutations are disabled for this demo.',
      );
      return null;
    }
    let el: Element | null = null;
    if (doc) {
      try {
        el = doc.querySelector(selector);
      } catch (err) {
        // Only swallow invalid-selector syntax errors. Anything else
        // (e.g. a security exception) should propagate so callers / the
        // browser console see the real failure.
        if (err instanceof DOMException && err.name === 'SyntaxError') {
          el = null;
        } else {
          throw err;
        }
      }
    }
    // Only cache positive matches. A null result may simply mean the
    // element hasn't been mutated/inserted yet within this step; caching
    // it would mask later successful queries against the same selector.
    if (el) cache.set(selector, el);
    return el;
  };

  const applyMutations = (step: DemoStep) => {
    if (!step.mutations) return;
    step.mutations.forEach((mutation) => {
      const el = queryCached(mutation.selector);
      if (!el) return;
      if (mutation.action === 'text') el.textContent = mutation.value;
      if (mutation.action === 'style') (el as HTMLElement).style.cssText += mutation.value;
      if (mutation.action === 'hide') (el as HTMLElement).style.display = 'none';
    });
  };

  const computeHotspotPositions = (step: DemoStep) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const iframeRect = iframe.getBoundingClientRect();
    if (!iframeRect.width || !iframeRect.height) return;

    const next: Record<string, HotspotPosition> = {};
    for (const hotspot of step.hotspots) {
      const el = queryCached(hotspot.selector);
      if (!el) continue;
      let rect: DOMRect;
      try {
        rect = (el as HTMLElement).getBoundingClientRect();
      } catch (err) {
        // Defensive: getBoundingClientRect can throw on detached / cross-
        // origin nodes. Skip rather than crash the render loop, but log
        // so authors can debug missing hotspots without source-diving.
        // eslint-disable-next-line no-console
        console.debug('[DemoFlow] getBoundingClientRect failed for selector', hotspot.selector, err);
        continue;
      }
      next[hotspot.id] = {
        top: `${((rect.top + rect.height / 2) / iframeRect.height) * 100}%`,
        left: `${((rect.left + rect.width / 2) / iframeRect.width) * 100}%`,
      };
    }
    setHotspotPositions(next);
  };

  // Inject the current step's content into the iframe and prepare overlays.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !currentStep) return;
    let cancelled = false;

    selectorCacheRef.current.clear();
    setHotspotPositions({});
    setIframeAccessError(null);

    const inject = currentStep.html
      ? injectHtmlIntoIframe(iframe, currentStep.html)
      : currentStep.snapshot
        ? injectSnapshotIntoIframe(iframe, currentStep.snapshot)
        : Promise.resolve();

    inject.then(() => {
      if (cancelled) return;
      applyMutations(currentStep);
      computeHotspotPositions(currentStep);
    });

    setProgress(0);

    return () => {
      cancelled = true;
    };
  }, [safeStepIndex, currentStep]);

  // Recompute hotspot positions when the iframe is resized.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (currentStep) computeHotspotPositions(currentStep);
    });
    observer.observe(iframe);
    return () => observer.disconnect();
  }, [currentStep]);

  // Drive the per-step keyframe animation. The hook owns the rAF loop and
  // playhead; we just supply the inputs and consume the interpolated values
  // through callbacks so the rest of the player's state stays local.
  const handleAnimationComplete = useCallback(() => setIsPlaying(false), []);
  const { playheadRef } = useKeyframeAnimation({
    step: currentStep,
    isPlaying,
    speed,
    reducedMotion,
    onCursorChange: setCursorPos,
    onClickingChange: setIsClicking,
    onProgressChange: setProgress,
    onComplete: handleAnimationComplete,
  });

  const goToIndex = useCallback(
    (idx: number, autoplay = false) => {
      const clamped = Math.max(0, Math.min(idx, script.steps.length - 1));
      setCurrentStepIndex(clamped);
      setIsPlaying(autoplay);
      setProgress(0);
      // Reset the playhead explicitly so "restart current step" works even
      // when the step identity is unchanged (the hook only auto-resets on
      // step change).
      playheadRef.current = 0;
      return clamped;
    },
    [script.steps.length, playheadRef],
  );

  const goToStepId = useCallback(
    (target: string | number): boolean => {
      // Numeric (or numeric-string) targets: validate the index is a
      // non-negative integer in range before jumping so invalid inputs fail
      // fast instead of reporting success for a different step. Floats like
      // 1.5 are also rejected here because array access with a fractional
      // index yields undefined and breaks step rendering downstream.
      if (typeof target === 'number') {
        if (!Number.isInteger(target) || target < 0 || target >= script.steps.length) return false;
        goToIndex(target, false);
        return true;
      }
      const numeric = Number(target);
      const isNumericString = !Number.isNaN(numeric) && String(numeric) === target;
      if (isNumericString) {
        if (!Number.isInteger(numeric) || numeric < 0 || numeric >= script.steps.length) return false;
        goToIndex(numeric, false);
        return true;
      }
      const idx = script.steps.findIndex((s) => s.id === target);
      if (idx === -1) return false;
      goToIndex(idx, false);
      return true;
    },
    [goToIndex, script],
  );

  const handleHotspotClick = (nextStepId: string) => {
    const nextIdx = script.steps.findIndex((s) => s.id === nextStepId);
    if (nextIdx !== -1) {
      goToIndex(nextIdx, true);
    }
  };

  const handlePrev = useCallback(() => goToIndex(safeStepIndex - 1, false), [goToIndex, safeStepIndex]);
  const handleNext = useCallback(() => goToIndex(safeStepIndex + 1, false), [goToIndex, safeStepIndex]);
  const handleRestart = useCallback(() => goToIndex(0, true), [goToIndex]);

  // Imperative handle for parent (App) to drive the player from
  // postMessage / URL state without lifting all this state up.
  useImperativeHandle(
    ref,
    (): DemoPlayerHandle => ({
      play: () => setIsPlaying(true),
      pause: () => setIsPlaying(false),
      goToStep: goToStepId,
      next: handleNext,
      prev: handlePrev,
      restart: handleRestart,
      getState: () => ({
        stepId: currentStep?.id ?? '',
        index: safeStepIndex,
        total: script.steps.length,
        isPlaying,
      }),
    }),
    [goToStepId, handleNext, handlePrev, handleRestart, currentStep, safeStepIndex, script.steps.length, isPlaying],
  );

  // Keyboard shortcuts. Only fire when focus is not inside an editable
  // control (input/textarea/contentEditable) so we don't hijack typing.
  useEffect(() => {
    const isEditableTarget = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (t.isContentEditable) return true;
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          setIsPlaying((p) => !p);
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleNext();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handlePrev();
          break;
        case 'Home':
          e.preventDefault();
          goToIndex(0, false);
          break;
        case 'End':
          e.preventDefault();
          goToIndex(script.steps.length - 1, false);
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          handleRestart();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleNext, handlePrev, handleRestart, goToIndex, script.steps.length]);

  const visibleHotspots = useMemo(
    () => (currentStep ? currentStep.hotspots.filter((h) => hotspotPositions[h.id]) : []),
    [currentStep, hotspotPositions],
  );

  if (!currentStep) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-slate-400 text-sm">
        No demo step available.
      </div>
    );
  }

  // Step caption: prefer authored copy. Mutation values are deliberately
  // *not* used as a fallback — they're page content (e.g. "Welcome to
  // DemoFlow!") and surfacing them as a step caption is surprising. If a
  // step has no title or description we render no caption at all.
  const stepCaption = currentStep.description || currentStep.title;

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-slate-950 relative overflow-hidden">
      {/* Player Header */}
      {!embed && (
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex gap-4 font-mono items-center flex-wrap">
            <div className="text-[10px] font-bold px-3 py-1 bg-slate-900 border border-slate-700 rounded text-slate-300 tracking-widest uppercase">
              STEP_{String(safeStepIndex + 1).padStart(2, '0')} <span className="text-slate-500 ml-1">/ {String(script.steps.length).padStart(2, '0')}</span>
            </div>
            <div className="text-[10px] font-bold px-3 py-1 bg-brand/5 border border-brand/20 rounded text-brand tracking-widest uppercase">
              STATUS: {isPlaying ? 'REPLAYING' : 'PAUSED'}
            </div>
            {currentStep.title && (
              <div className="text-[11px] text-slate-300 truncate max-w-[260px]" title={currentStep.title}>
                {currentStep.title}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRestart}
              className="w-3 h-3 rounded-full bg-[#FF5F56] hover:scale-110 transition-transform cursor-pointer"
              title="Restart demo from first step (R) — not a window-close button"
              aria-label="Restart demo from first step"
            />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" aria-hidden="true" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F]" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Cross-origin / inaccessible iframe banner. Surfaced when content
          can't be queried (e.g. ?demo=<url> resolved to a different origin). */}
      {iframeAccessError && (
        <div
          role="alert"
          className="mb-3 px-3 py-2 rounded border border-red-500/40 bg-red-500/10 text-[11px] text-red-300 font-mono"
        >
          {iframeAccessError}
        </div>
      )}

      {/* Simulated Iframe Viewport Container */}
      <div className="flex-1 rounded-2xl border border-white/5 shadow-brand-glow overflow-hidden bg-white relative">
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0 pointer-events-none"
          title="Demo Sandbox"
          sandbox="allow-same-origin"
        />

        {/* Interaction Layers */}
        <AnimatePresence>
          {!isPlaying && visibleHotspots.length > 0 && (
            <div className="absolute inset-0 pointer-events-auto bg-brand/5 backdrop-blur-[1px]">
              {visibleHotspots.map((hotspot) => (
                <Fragment key={hotspot.id}>
                  <HotspotOverlay
                    hotspot={hotspot}
                    position={hotspotPositions[hotspot.id]}
                    onClick={() => handleHotspotClick(hotspot.nextStepId)}
                  />
                </Fragment>
              ))}
            </div>
          )}
        </AnimatePresence>

        <VirtualCursor x={cursorPos.x} y={cursorPos.y} isClicking={isClicking} />

        {/* Frame Border / Shield Effect */}
        <div className="absolute inset-0 pointer-events-none border-[12px] border-slate-950"></div>
      </div>

      {/* Live region for screen readers — announces the current step. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Step {safeStepIndex + 1} of {script.steps.length}
        {currentStep.title ? `: ${currentStep.title}` : ''}
      </div>

      {/* Timeline Controls */}
      <div className="mt-8 flex items-center gap-4 shrink-0 flex-wrap">
        <button
          onClick={handlePrev}
          disabled={safeStepIndex === 0}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-slate-300 hover:text-brand hover:border-brand/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Previous step (←)"
          aria-label="Previous step"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="w-12 h-12 flex items-center justify-center rounded-full bg-brand text-black shrink-0 shadow-lg shadow-brand/20 hover:scale-105 transition-all active:scale-95 group"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <div className="flex gap-1">
              <div className="w-1.5 h-4 bg-black rounded-full" />
              <div className="w-1.5 h-4 bg-black rounded-full" />
            </div>
          ) : (
            // Inline SVG triangle. `lucide-react`'s Play icon doesn't render
            // a filled triangle reliably across versions (its inner paths
            // ignore `fill="currentColor"` in some builds), so we draw the
            // triangle directly to guarantee a solid play glyph.
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="ml-1"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          onClick={handleNext}
          disabled={safeStepIndex >= script.steps.length - 1}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-slate-300 hover:text-brand hover:border-brand/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Next step (→)"
          aria-label="Next step"
        >
          <ChevronRight size={18} />
        </button>
        <button
          onClick={handleRestart}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-slate-300 hover:text-brand hover:border-brand/40 transition-colors"
          title="Restart (R)"
          aria-label="Restart"
        >
          <RotateCcw size={16} />
        </button>

        <div className="flex-1 min-w-[120px] h-[2px] bg-slate-800 relative">
          <div
            className="absolute left-0 top-0 h-full bg-brand transition-all duration-100 ease-linear shadow-[0_0_8px_rgba(0,255,194,0.5)]"
            style={{ width: `${progress}%` }}
          />
          <motion.div
            className="absolute -top-1 w-2.5 h-2.5 bg-white rounded-full shadow-[0_0_10px_white] z-10"
            animate={{ left: `${progress}%` }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { type: 'tween', ease: 'linear', duration: 0.1 }
            }
          />
        </div>

        {/* Speed control */}
        <div
          className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded p-0.5"
          role="group"
          aria-label="Playback speed"
        >
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              aria-pressed={speed === s}
              className={`px-2 py-0.5 text-[10px] font-mono rounded ${
                speed === s ? 'bg-brand text-black' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="text-[11px] font-mono text-slate-500 w-20 text-right tabular-nums">
          {Math.floor(playheadRef.current / 1000).toString().padStart(2, '0')}:
          {Math.floor((playheadRef.current % 1000) / 10).toString().padStart(2, '0')}
        </div>
      </div>

      {/* Step navigator pills */}
      {!embed && script.steps.length > 1 && (
        <nav
          className="mt-4 flex items-center gap-1.5 overflow-x-auto pb-1 shrink-0"
          aria-label="Demo steps"
        >
          {script.steps.map((s, i) => {
            const isActive = i === safeStepIndex;
            return (
              <button
                key={s.id}
                onClick={() => goToIndex(i, false)}
                aria-current={isActive ? 'step' : undefined}
                className={`px-2.5 py-1 text-[10px] font-mono rounded border whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-brand/10 border-brand/40 text-brand'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                }`}
                title={s.title || s.id}
              >
                {String(i + 1).padStart(2, '0')} · {s.title || s.id}
              </button>
            );
          })}
        </nav>
      )}

      {/* Tooltip Overlay */}
      <AnimatePresence>
        {!isPlaying && stepCaption && (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 flex items-center gap-3 max-w-[80%]"
          >
            <div className="w-2 h-2 rounded-full bg-brand animate-pulse shrink-0" aria-hidden="true" />
            <p className="text-[10px] font-bold text-slate-200 tracking-widest uppercase truncate">
              {stepCaption}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

function HotspotOverlay({
  hotspot,
  position,
  onClick,
}: {
  hotspot: Hotspot;
  position: HotspotPosition;
  onClick: () => void;
}) {
  // Visible tooltip prefers description, then label, then a generic verb.
  // The aria-label avoids announcing the label twice when it is also the
  // visible tip (previously this produced "label: label" for hotspots that
  // had a label but no description).
  const tip = hotspot.description || hotspot.label || 'Activate hotspot';
  const ariaLabel =
    hotspot.label && hotspot.description && hotspot.label !== hotspot.description
      ? `${hotspot.label}: ${hotspot.description}`
      : tip;
  return (
    <motion.button
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.1 }}
      onClick={onClick}
      aria-label={ariaLabel}
      className="absolute flex items-center gap-2 group z-30 -translate-x-1/2 -translate-y-1/2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 rounded-full"
      style={position}
    >
      <div className="w-10 h-10 rounded-full bg-blue-500/30 border-2 border-blue-500 animate-pulse flex items-center justify-center p-2">
        <div className="w-4 h-4 bg-blue-600 rounded-full shadow-[0_0_10px_rgba(37,99,235,0.8)]" />
      </div>
      <div
        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium shadow-xl opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity whitespace-nowrap max-w-xs"
        role="tooltip"
      >
        {tip}
      </div>
    </motion.button>
  );
}
