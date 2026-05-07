/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { DemoScript, DemoStep, Hotspot } from '../types';
import { injectHtmlIntoIframe, injectSnapshotIntoIframe } from '../lib/utils';
import { VirtualCursor } from './VirtualCursor';
import { motion, AnimatePresence } from 'motion/react';
import { Play } from 'lucide-react';

interface DemoPlayerProps {
  script: DemoScript;
}

type HotspotPosition = { top: string; left: string };

export function DemoPlayer({ script }: DemoPlayerProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 });
  const [isClicking, setIsClicking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hotspotPositions, setHotspotPositions] = useState<Record<string, HotspotPosition>>({});

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playheadRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);
  // Per-inject cache of querySelector results to avoid repeat traversal
  // of large DOMs across mutations and hotspot positioning.
  const selectorCacheRef = useRef<Map<string, Element | null>>(new Map());

  // Reset to first step whenever the script identity changes (e.g. after a
  // file load) so we never index past the end of `script.steps`.
  useEffect(() => {
    setCurrentStepIndex(0);
    setIsPlaying(false);
    playheadRef.current = 0;
    setProgress(0);
  }, [script]);

  const safeStepIndex = Math.min(currentStepIndex, Math.max(script.steps.length - 1, 0));
  const currentStep = script.steps[safeStepIndex];

  const queryCached = (selector: string): Element | null => {
    const cache = selectorCacheRef.current;
    if (cache.has(selector)) return cache.get(selector) ?? null;
    const doc = iframeRef.current?.contentDocument;
    const el = doc ? doc.querySelector(selector) : null;
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

    const animate = (time: number) => {
      if (!lastUpdateRef.current) lastUpdateRef.current = time;
      const deltaTime = time - lastUpdateRef.current;
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
  }, [isPlaying, currentStep]);

  const handleHotspotClick = (nextStepId: string) => {
    const nextIdx = script.steps.findIndex((s) => s.id === nextStepId);
    if (nextIdx !== -1) {
      setCurrentStepIndex(nextIdx);
      setIsPlaying(true);
    }
  };

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

  return (
    <div className="flex flex-col h-full bg-slate-950 relative overflow-hidden">
      {/* Player Header */}
      <div className="flex justify-between items-center mb-6 shrink-0">
        <div className="flex gap-4 font-mono">
          <div className="text-[10px] font-bold px-3 py-1 bg-slate-900 border border-slate-700 rounded text-slate-300 tracking-widest uppercase">
            STEP_{String(safeStepIndex + 1).padStart(2, '0')} <span className="text-slate-500 ml-1">/ {String(script.steps.length).padStart(2, '0')}</span>
          </div>
          <div className="text-[10px] font-bold px-3 py-1 bg-brand/5 border border-brand/20 rounded text-brand tracking-widest uppercase">
            STATUS: {isPlaying ? 'REPLAYING' : 'PAUSED'}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setCurrentStepIndex(0);
              setIsPlaying(true);
            }}
            className="w-3 h-3 rounded-full bg-[#FF5F56] hover:scale-110 transition-transform cursor-pointer"
            title="Reset"
          />
          <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
          <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
        </div>
      </div>

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

      {/* Timeline Controls */}
      <div className="mt-8 flex items-center gap-6 shrink-0">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="w-12 h-12 flex items-center justify-center rounded-full bg-brand text-black shrink-0 shadow-lg shadow-brand/20 hover:scale-105 transition-all active:scale-95 group"
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

        <div className="flex-1 h-[2px] bg-slate-800 relative">
          <div
            className="absolute left-0 top-0 h-full bg-brand transition-all duration-100 ease-linear shadow-[0_0_8px_rgba(0,255,194,0.5)]"
            style={{ width: `${progress}%` }}
          />
          <motion.div
            className="absolute -top-1 w-2.5 h-2.5 bg-white rounded-full shadow-[0_0_10px_white] z-10"
            animate={{ left: `${progress}%` }}
            transition={{ type: 'tween', ease: 'linear', duration: 0.1 }}
          />
        </div>

        <div className="text-[11px] font-mono text-slate-500 w-24 text-right tabular-nums">
          {Math.floor(playheadRef.current / 1000).toString().padStart(2, '0')}:
          {Math.floor((playheadRef.current % 1000) / 10).toString().padStart(2, '0')}
        </div>
      </div>

      {/* Tooltip Overlay */}
      <AnimatePresence>
        {!isPlaying && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 flex items-center gap-3"
          >
            <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
            <p className="text-[10px] font-bold text-slate-200 tracking-widest uppercase">
              {currentStep.mutations?.[0]?.value || 'Interaction Required'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HotspotOverlay({
  hotspot,
  position,
  onClick,
}: {
  hotspot: Hotspot;
  position: HotspotPosition;
  onClick: () => void;
}) {
  return (
    <motion.button
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.1 }}
      onClick={onClick}
      className="absolute flex items-center gap-2 group z-30 -translate-x-1/2 -translate-y-1/2"
      style={position}
    >
      <div className="w-10 h-10 rounded-full bg-blue-500/30 border-2 border-blue-500 animate-pulse flex items-center justify-center p-2">
        <div className="w-4 h-4 bg-blue-600 rounded-full shadow-[0_0_10px_rgba(37,99,235,0.8)]" />
      </div>
      <div className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        {hotspot.label || 'Click here'}
      </div>
    </motion.button>
  );
}
