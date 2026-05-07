/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { DemoScript, DemoStep, Keyframe } from '../types';
import { injectSnapshotIntoIframe } from '../lib/utils';
import { VirtualCursor } from './VirtualCursor';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCcw, ChevronRight } from 'lucide-react';

interface DemoPlayerProps {
  script: DemoScript;
}

export function DemoPlayer({ script }: DemoPlayerProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 });
  const [isClicking, setIsClicking] = useState(false);
  const [progress, setProgress] = useState(0);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playheadRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);

  const currentStep = script.steps[currentStepIndex];

  // Initialize Iframe with snapshot when step changes
  useEffect(() => {
    if (iframeRef.current && currentStep.snapshot) {
      injectSnapshotIntoIframe(iframeRef.current, currentStep.snapshot);
      applyMutations(currentStep);
    }
    // Reset playhead on step change
    playheadRef.current = 0;
    setProgress(0);
  }, [currentStepIndex, currentStep]);

  const applyMutations = (step: DemoStep) => {
    if (!step.mutations || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    step.mutations.forEach(mutation => {
      const el = doc.querySelector(mutation.selector);
      if (el) {
        if (mutation.action === 'text') el.textContent = mutation.value;
        if (mutation.action === 'style') (el as HTMLElement).style.cssText += mutation.value;
        if (mutation.action === 'hide') (el as HTMLElement).style.display = 'none';
      }
    });
  };

  // The Animation Loop
  useEffect(() => {
    if (!isPlaying) return;

    const animate = (time: number) => {
      if (!lastUpdateRef.current) lastUpdateRef.current = time;
      const deltaTime = time - lastUpdateRef.current;
      lastUpdateRef.current = time;

      playheadRef.current += deltaTime;

      // Find current keyframe segment
      const keyframes = currentStep.keyframes;
      const totalDuration = keyframes[keyframes.length - 1]?.timestamp || 0;

      if (playheadRef.current >= totalDuration) {
        setIsPlaying(false);
        setProgress(100);
        return;
      }

      setProgress((playheadRef.current / totalDuration) * 100);

      // Interpolate position
      const nextIdx = keyframes.findIndex(k => k.timestamp > playheadRef.current);
      const prevIdx = nextIdx > 0 ? nextIdx - 1 : 0;
      
      const prev = keyframes[prevIdx];
      const next = keyframes[nextIdx];

      if (prev && next) {
        const segmentProgress = (playheadRef.current - prev.timestamp) / (next.timestamp - prev.timestamp);
        setCursorPos({
          x: prev.x + (next.x - prev.x) * segmentProgress,
          y: prev.y + (next.y - prev.y) * segmentProgress,
        });

        if (next.type === 'click' && segmentProgress > 0.9) {
          setIsClicking(true);
        } else {
          setIsClicking(false);
        }
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
    const nextIdx = script.steps.findIndex(s => s.id === nextStepId);
    if (nextIdx !== -1) {
      setCurrentStepIndex(nextIdx);
      setIsPlaying(true);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 relative overflow-hidden">
      {/* Player Header */}
      <div className="flex justify-between items-center mb-6 shrink-0">
        <div className="flex gap-4 font-mono">
          <div className="text-[10px] font-bold px-3 py-1 bg-slate-900 border border-slate-700 rounded text-slate-300 tracking-widest uppercase">
            STEP_{String(currentStepIndex + 1).padStart(2, '0')} <span className="text-slate-500 ml-1">/ {String(script.steps.length).padStart(2, '0')}</span>
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
        />

        {/* Interaction Layers */}
        <AnimatePresence>
          {!isPlaying && (
            <div className="absolute inset-0 pointer-events-auto bg-brand/5 backdrop-blur-[1px]">
              {currentStep.hotspots.map((hotspot) => (
                <HotspotOverlay
                  key={hotspot.id}
                  hotspot={hotspot}
                  iframeRef={iframeRef}
                  onClick={() => handleHotspotClick(hotspot.nextStepId)}
                />
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
              {currentStep.mutations?.[0]?.value || "Interaction Required"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HotspotOverlay({ hotspot, iframeRef, onClick }: { hotspot: any, iframeRef: React.RefObject<HTMLIFrameElement | null>, onClick: () => void }) {
  const [position, setPosition] = useState({ top: '50%', left: '50%' });

  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    const el = doc.querySelector(hotspot.selector);
    if (el) {
      const rect = el.getBoundingClientRect();
      const iframeRect = iframeRef.current.getBoundingClientRect();
      
      // Calculate percentage based on iframe size
      setPosition({
        top: `${(rect.top + rect.height / 2) / iframeRect.height * 100}%`,
        left: `${(rect.left + rect.width / 2) / iframeRect.width * 100}%`,
      });
    }
  }, [hotspot.selector, iframeRef]);

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
