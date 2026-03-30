'use client';

/**
 * CanvasControls — Zoom In / Zoom Out / Fit buttons + zoom percentage display.
 * Liquid Glass design: frosted glass panel, generous radius.
 */

import { useAtomValue } from 'jotai';
import { memo, useCallback } from 'react';
import { viewportAtom } from '../model/viewport-atom';

interface CanvasControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export const CanvasControls = memo(function CanvasControls({
  onZoomIn,
  onZoomOut,
  onReset,
}: CanvasControlsProps) {
  const viewport = useAtomValue(viewportAtom);
  const percent = Math.round(viewport.scale * 100);

  const handleReset = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onReset();
    },
    [onReset],
  );

  return (
    <div
      className="exclude-from-export absolute bottom-12 left-4 flex items-stretch bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl border border-black/5 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-white/5 rounded-2xl overflow-hidden z-40 select-none"
      data-testid="canvas-controls"
    >
      <button
        onClick={onZoomOut}
        data-testid="btn-zoom-out"
        className="px-4 py-2 bg-transparent border-none text-[18px] font-bold text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 transition-colors active:bg-black/10 dark:active:bg-white/20"
        title="Zoom Out"
      >
        &minus;
      </button>

      <div
        onClick={handleReset}
        title="Reset zoom (double-click canvas)"
        className="px-3 py-2 text-[12px] font-mono font-bold text-slate-500 dark:text-slate-400 cursor-pointer flex items-center justify-center min-w-[56px] border-x border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/10 transition-colors bg-black/5 dark:bg-white/5"
      >
        {percent}%
      </div>

      <button
        onClick={onZoomIn}
        data-testid="btn-zoom-in"
        className="px-4 py-2 bg-transparent border-none text-[18px] font-bold text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 transition-colors active:bg-black/10 dark:active:bg-white/20"
        title="Zoom In"
      >
        +
      </button>
    </div>
  );
});
