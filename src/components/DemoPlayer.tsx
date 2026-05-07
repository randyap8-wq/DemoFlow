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
import { VirtualCursor } from './VirtualCursor';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Play, RotateCcw } from 'lucide-react';

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
    if (Number.isFinite(target) && target >= 0 && target < script.steps.length) return target;
    return 0;
  }
  const numeric = Number(target);
  if (!Number.isNaN(numeric) && String(numeric) === target) {
    if (numeric >= 0 && numeric < script.steps.length) return numeric;
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

  const reducedMotion = usePrefersReducedMotion();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);
  // Per-inject cache of querySelector results to avoid repeat traversal
  // of large DOMs across mutations and hotspot positioning.
  const selectorCacheRef = useRef<Map<string, Element | null>>(new Map());

  // Reset to first step whenever the script identity changes (e.g. after a
  // file load) so we never index past the end of `script.steps`.
  useEffect(() => {
    setCurrentStepIndex(resolveStepIndex(script, initialStep));
    setIsPlaying(false);
    playheadRef.current = 0;
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
    const doc = iframeRef.current?.contentDocument;
    let el: Element | null = null;
    if (doc) {
      try {
        el = doc.querySelector(selector);
      } catch {
        // Invalid selector — treat as missing rather than crashing.
        el = null;
      }
    }
    cache.set(selector, el);
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
      const rect = (el as HTMLElement).getBoundingClientRect();
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

    playheadRef.current = 0;
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

  // The Animation Loop
  useEffect(() => {
    if (!isPlaying || !currentStep) return;

    const keyframes = currentStep.keyframes;
    const totalDuration = keyframes[keyframes.length - 1]?.timestamp || 0;
    if (!keyframes.length || totalDuration <= 0) {
      setIsPlaying(false);
      return;
    }

    // Reduced-motion: jump straight to the final keyframe instead of
    // animating between them. We still drive the progress bar so users
    // can see playback completed.
    if (reducedMotion) {
      const last = keyframes[keyframes.length - 1];
      setCursorPos({ x: last.x, y: last.y });
      setProgress(100);
      setIsPlaying(false);
      return;
    }

    const animate = (time: number) => {
      if (!lastUpdateRef.current) lastUpdateRef.current = time;
      // Scale wall-clock delta by `speed` so 2× advances the playhead twice
      // as fast and 0.5× advances half as fast. Keyframe timestamps stay
      // unchanged; only the rate at which we walk through them changes.
      const deltaTime = (time - lastUpdateRef.current) * speed;
      lastUpdateRef.current = time;

      playheadRef.current += deltaTime;

      if (playheadRef.current >= totalDuration) {
        setIsPlaying(false);
        setProgress(100);
        return;
      }

      setProgress((playheadRef.current / totalDuration) * 100);

      const nextIdx = keyframes.findIndex((k) => k.timestamp > playheadRef.current);
      const prevIdx = nextIdx > 0 ? nextIdx - 1 : 0;

      const prev = keyframes[prevIdx];
      const next = keyframes[nextIdx];

      if (prev && next) {
        const segmentProgress =
          (playheadRef.current - prev.timestamp) / (next.timestamp - prev.timestamp);
        setCursorPos({
          x: prev.x + (next.x - prev.x) * segmentProgress,
          y: prev.y + (next.y - prev.y) * segmentProgress,
        });

        setIsClicking(next.type === 'click' && segmentProgress > 0.9);
      }

      requestAnimationFrame(animate);
    };

    const requestId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(requestId);
      lastUpdateRef.current = 0;
    };
  }, [isPlaying, currentStep, speed, reducedMotion]);

  const goToIndex = useCallback(
    (idx: number, autoplay = false) => {
      const clamped = Math.max(0, Math.min(idx, script.steps.length - 1));
      setCurrentStepIndex(clamped);
      setIsPlaying(autoplay);
      playheadRef.current = 0;
      setProgress(0);
      return clamped;
    },
    [script.steps.length],
  );

  const goToStepId = useCallback(
    (target: string | number): boolean => {
      const idx = resolveStepIndex(script, target);
      const validId = typeof target === 'string' ? script.steps.some((s) => s.id === target) : true;
      if (!validId && typeof target === 'string' && Number.isNaN(Number(target))) return false;
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

  const stepCaption = currentStep.description || currentStep.title || currentStep.mutations?.[0]?.value;

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
              title="Restart from first step (R)"
              aria-label="Restart from first step"
            />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" aria-hidden="true" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F]" aria-hidden="true" />
          </div>
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
            <Play size={24} fill="currentColor" className="ml-1" />
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
            className="absolute bottom-32 left-1/2 -translate-x-1/2 px-6 py-3 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 flex items-center gap-3 max-w-[80%]"
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
  const tip = hotspot.description || hotspot.label || 'Activate hotspot';
  return (
    <motion.button
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.1 }}
      onClick={onClick}
      aria-label={hotspot.label ? `${hotspot.label}: ${tip}` : tip}
      className="absolute flex items-center gap-2 group z-30 -translate-x-1/2 -translate-y-1/2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 rounded-full"
      style={position}
    >
      <div className="w-10 h-10 rounded-full bg-blue-500/30 border-2 border-blue-500 animate-pulse flex items-center justify-center p-2">
        <div className="w-4 h-4 bg-blue-600 rounded-full shadow-[0_0_10px_rgba(37,99,235,0.8)]" />
      </div>
      <div
        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium shadow-xl opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity whitespace-nowrap max-w-xs"
        role="tooltip"
      >
        {tip}
      </div>
    </motion.button>
  );
}
