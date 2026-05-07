/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { DemoPlayer } from './components/DemoPlayer';
import { SAMPLE_DEMO } from './constants';
import { DemoScript } from './types';
import { loadScriptFromPublic, parseDemoFile } from './lib/scriptLoader';

export default function App() {
  const [script, setScript] = useState<DemoScript>(SAMPLE_DEMO);
  const [scriptSource, setScriptSource] = useState<string>('Bundled sample');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Recommendation #1: try to load the demo from /public at runtime so the
  // script does not have to be bundled into the JS payload.
  useEffect(() => {
    let cancelled = false;
    loadScriptFromPublic()
      .then((loaded) => {
        if (cancelled || !loaded) return;
        setScript(loaded);
        setScriptSource('public/ (runtime fetch)');
      })
      .catch(() => {
        // Silently fall back to SAMPLE_DEMO.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          <DemoPlayer script={script} />
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
