/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { DemoPlayer, type DemoPlayerHandle } from './components/DemoPlayer';
import { SAMPLE_DEMO } from './constants';
import { DemoScript } from './types';
import {
  exportScriptAsJson,
  loadScriptFromPublic,
  loadScriptFromUrl,
  parseDemoFile,
} from './lib/scriptLoader';

/** Read a URL/hash flag for the embed mode and any deep-link state. */
function readUrlState(): {
  embed: boolean;
  demoUrl: string | null;
  initialStep: string | null;
} {
  if (typeof window === 'undefined') return { embed: false, demoUrl: null, initialStep: null };
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith('#')
    ? new URLSearchParams(window.location.hash.slice(1))
    : new URLSearchParams();
  return {
    embed: params.get('embed') === '1' || params.get('embed') === 'true',
    demoUrl: params.get('demo'),
    initialStep: hash.get('step') || params.get('step'),
  };
}

export default function App() {
  const urlState = useMemo(() => readUrlState(), []);

  const [script, setScript] = useState<DemoScript>(SAMPLE_DEMO);
  const [scriptSource, setScriptSource] = useState<string>('Bundled sample');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<DemoPlayerHandle>(null);

  // Resolve startup script: ?demo=<url> takes precedence over public/demo.json,
  // which takes precedence over the bundled SAMPLE_DEMO.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (urlState.demoUrl) {
        try {
          const loaded = await loadScriptFromUrl(urlState.demoUrl);
          if (cancelled) return;
          setScript(loaded);
          setScriptSource(`url: ${urlState.demoUrl}`);
          return;
        } catch (err) {
          if (!cancelled) setLoadError((err as Error).message);
          // fall through to public/ load
        }
      }
      try {
        const loaded = await loadScriptFromPublic();
        if (cancelled || !loaded) return;
        setScript(loaded);
        setScriptSource('public/ (runtime fetch)');
      } catch {
        // Silently fall back to SAMPLE_DEMO.
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [urlState.demoUrl]);

  const loadFile = useCallback(async (file: File) => {
    setLoadError(null);
    try {
      const parsed = await parseDemoFile(file);
      setScript(parsed);
      setScriptSource(file.name);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    // Reset so the same file can be re-selected.
    e.target.value = '';
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  const resetToSample = () => {
    setScript(SAMPLE_DEMO);
    setScriptSource('Bundled sample');
    setLoadError(null);
  };

  // Download the currently loaded script as JSON.
  const handleExport = useCallback(() => {
    const json = exportScriptAsJson(script);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle = (script.title || 'demo').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
    a.href = url;
    a.download = `${safeTitle || 'demo'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [script]);

  // Sync the current step into the URL hash so links are deep-linkable, and
  // notify embedders via postMessage.
  const handleStepChange = useCallback(
    (info: { stepId: string; index: number; total: number }) => {
      try {
        const next = `#step=${encodeURIComponent(info.stepId)}`;
        if (typeof window !== 'undefined' && window.location.hash !== next) {
          // Use replaceState to avoid spamming history on autoplay.
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`);
        }
      } catch {
        // ignore — non-browser environments
      }
      try {
        window.parent?.postMessage({ source: 'demoflow', type: 'stepChanged', ...info }, '*');
      } catch {
        // ignore — sandboxed parents may reject
      }
    },
    [],
  );

  // postMessage API: parents can drive the player via window.postMessage.
  // Accepted message shape: { source: 'demoflow', type: 'play' | 'pause' |
  // 'next' | 'prev' | 'restart' | 'goToStep' | 'getState', stepId? }.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== 'object' || data.source !== 'demoflow') return;
      const player = playerRef.current;
      if (!player) return;
      switch (data.type) {
        case 'play':
          player.play();
          break;
        case 'pause':
          player.pause();
          break;
        case 'next':
          player.next();
          break;
        case 'prev':
          player.prev();
          break;
        case 'restart':
          player.restart();
          break;
        case 'goToStep':
          if (data.stepId != null) player.goToStep(data.stepId);
          break;
        case 'getState':
          try {
            window.parent?.postMessage(
              { source: 'demoflow', type: 'state', ...player.getState() },
              '*',
            );
          } catch {
            // ignore
          }
          break;
      }
    };
    window.addEventListener('message', onMessage);
    // Announce readiness.
    try {
      window.parent?.postMessage({ source: 'demoflow', type: 'ready' }, '*');
    } catch {
      // ignore
    }
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // ----- Embed mode renders just the player, full bleed -----
  if (urlState.embed) {
    return (
      <div className="h-screen w-screen bg-slate-950 text-slate-300 font-sans p-2 overflow-hidden">
        <DemoPlayer
          ref={playerRef}
          script={script}
          embed
          initialStep={urlState.initialStep ?? undefined}
          onStepChange={handleStepChange}
        />
      </div>
    );
  }

  return (
    <div
      className="h-screen bg-slate-950 text-slate-300 font-sans flex flex-col overflow-hidden select-none relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header Section */}
      <header className="flex justify-between items-end p-8 border-b border-slate-700 shrink-0">
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-semibold">System Architecture // v1.0.4</p>
          <h1 className="text-5xl font-extrabold tracking-tighter text-white italic">DOM_REPLAY_ENGINE</h1>
        </div>
        <div className="text-right">
          <span className="px-3 py-1 bg-brand text-black text-[10px] font-bold rounded-full">PIXEL-PERFECT</span>
          <p className="text-xs mt-2 text-slate-500 font-mono">ST_ENG_SPEC_049</p>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">

        {/* Left Col: Loader + JSON Schema & File Structure */}
        <section className="col-span-4 border-r border-slate-700 flex flex-col p-6 space-y-6 bg-slate-900 overflow-y-auto">
          {/* Local file loader */}
          <div>
            <h3 className="text-[11px] uppercase tracking-widest text-slate-500 mb-3 border-l-2 border-brand pl-2">Local Demo Source</h3>
            <div className="rounded-lg border border-dashed border-slate-700 bg-black/40 p-4 text-[11px] font-mono space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">source:</span>
                <span className="text-brand truncate" title={scriptSource}>{scriptSource}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-md bg-brand text-black text-[10px] font-bold tracking-widest uppercase hover:opacity-90 transition-opacity"
                >
                  Load File
                </button>
                <button
                  onClick={resetToSample}
                  className="px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 text-[10px] font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors"
                >
                  Use Sample
                </button>
                <button
                  onClick={handleExport}
                  className="px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 text-[10px] font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors"
                  title="Download the current demo as JSON"
                >
                  Export JSON
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.html,.htm,application/json,text/html"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Pick a <span className="text-slate-300">.json</span> DemoScript or a raw <span className="text-slate-300">.html</span> file.
                You can also drag &amp; drop a file anywhere on this page. Files stay on your machine.
              </p>
              {loadError && (
                <p className="text-[10px] text-red-400 leading-relaxed">{loadError}</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-[11px] uppercase tracking-widest text-slate-500 mb-3 border-l-2 border-brand pl-2">Demo Script Schema</h3>
            <div className="bg-black rounded-lg p-4 font-mono text-[10px] leading-relaxed border border-slate-800 shadow-2xl overflow-x-auto whitespace-pre">
              <span className="text-purple-400">{"{"}</span><br/>
              &nbsp;&nbsp;<span className="text-blue-400">"title"</span>: <span className="text-amber-200">"Dashboard Tour"</span>,<br/>
              &nbsp;&nbsp;<span className="text-blue-400">"steps"</span>: <span className="text-purple-400">[</span><br/>
              &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-purple-400">{"{"}</span><br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-400">"id"</span>: <span className="text-amber-200">"step-1"</span>,<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-400">"hotspots"</span>: <span className="text-purple-400">[</span><br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-purple-400">{"{"}</span> <span className="text-blue-400">"selector"</span>: <span className="text-amber-200">"#cta"</span> <span className="text-purple-400">{"}"}</span><br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-purple-400">]</span><br/>
              &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-purple-400">{"}"}</span><br/>
              &nbsp;&nbsp;<span className="text-purple-400">]</span><br/>
              <span className="text-purple-400">{"}"}</span>
            </div>
          </div>

          <div>
            <h3 className="text-[11px] uppercase tracking-widest text-slate-500 mb-3 border-l-2 border-blue-500 pl-2">Keyboard Shortcuts</h3>
            <ul className="space-y-1.5 text-[11px] font-mono text-slate-400">
              <li><kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">Space</kbd> play / pause</li>
              <li><kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">←</kbd> / <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">→</kbd> previous / next step</li>
              <li><kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">Home</kbd> / <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">End</kbd> first / last step</li>
              <li><kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">R</kbd> restart from first step</li>
            </ul>
          </div>

          <div>
            <h3 className="text-[11px] uppercase tracking-widest text-slate-500 mb-3 border-l-2 border-blue-500 pl-2">Project Manifest</h3>
            <ul className="space-y-2 text-[11px] font-mono text-slate-400">
              <li className="flex items-center gap-2"><span className="text-brand">├─</span> src/engine/core/<b>player.tsx</b></li>
              <li className="flex items-center gap-2 text-slate-500"><span className="text-brand">├─</span> src/engine/core/<b>snapshot.ts</b></li>
              <li className="flex items-center gap-2"><span className="text-brand">├─</span> src/hooks/<b>use-virtual-pointer.ts</b></li>
              <li className="flex items-center gap-2 text-slate-500"><span className="text-brand">└─</span> public/<b>demo-assets/</b></li>
            </ul>
          </div>

          <div className="mt-auto pt-6">
            <div className="p-4 rounded-xl bg-gradient-to-br from-slate-800 to-slate-950 border border-slate-700">
              <p className="text-[10px] text-brand font-bold mb-1 tracking-wider uppercase">Optimization Note</p>
              <p className="text-[11px] text-slate-400 italic leading-relaxed">
                Serialized DOM snapshots must include inlined fonts and lazy-loaded assets to prevent flickering between step transitions.
              </p>
            </div>
          </div>
        </section>

        {/* Center Col: The Player Layer */}
        <section className="col-span-8 flex flex-col p-8 bg-slate-950 relative overflow-hidden">
          <DemoPlayer
            ref={playerRef}
            script={script}
            initialStep={urlState.initialStep ?? undefined}
            onStepChange={handleStepChange}
          />
        </section>
      </main>

      {/* Footer Bar */}
      <footer className="h-12 border-t border-slate-700 flex items-center px-8 bg-slate-900 text-[10px] uppercase tracking-widest text-slate-500 shrink-0">
        <div className="flex gap-8 items-center">
          <span className="text-brand font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
            Engine Active
          </span>
          <span>Buffer: 128MB</span>
          <span>Capture: rrweb-snapshot@2.0</span>
          <span>Latency: 42.4ms</span>
        </div>
        <div className="ml-auto italic lowercase tracking-normal text-slate-600">
          constructed for enterprise-grade replay scaling
        </div>
      </footer>

      {/* Drag & drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-[100] pointer-events-none flex items-center justify-center bg-slate-950/80 backdrop-blur-sm border-4 border-dashed border-brand">
          <p className="text-brand font-mono text-sm uppercase tracking-[0.3em]">
            Drop .json or .html to load
          </p>
        </div>
      )}
    </div>
  );
}
