'use client';

/**
 * CanvasControls — Zoom In / Zoom Out / Fit buttons + zoom percentage display.
 * Liquid Glass design: frosted glass panel, generous radius.
 */

import { useAtomValue } from 'jotai';
import { memo, useCallback } from 'react';
import { viewportAtom } from '../model/viewport-atom';
import { useTranslation } from '@shared/lib/i18n';

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
  const { t } = useTranslation();

  const handleReset = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onReset();
    },
    [onReset],
  );

  return (
    <div
      className="exclude-from-export absolute bottom-12 left-4 flex items-stretch bg-white/85 dark:bg-slate-900/85 backdrop-blur-2xl border border-black/10 dark:border-white/10 shadow-xl shadow-black/5 dark:shadow-white/5 rounded-2xl overflow-hidden z-40 select-none"
      data-testid="canvas-controls"
    >
      <button
        onClick={onZoomOut}
        data-testid="btn-zoom-out"
        aria-label={t('zoomOut')}
        className="px-4 py-2 bg-transparent border-none text-[18px] font-bold text-slate-900 dark:text-slate-50 cursor-pointer hover:bg-black/10 dark:hover:bg-white/15 transition-colors active:bg-black/15 dark:active:bg-white/25 disabled:opacity-50 disabled:cursor-not-allowed"
        title={t('zoomOut')}
      >
        &minus;
      </button>

      <button
        onClick={handleReset}
        title={t('resetZoom')}
        aria-label={t('resetZoom')}
        className="px-3 py-2 text-[12px] font-mono font-bold text-slate-900 dark:text-slate-50 cursor-pointer flex items-center justify-center min-w-[56px] border-x border-black/10 dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/15 transition-colors bg-black/10 dark:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {percent}%
      </button>

      <button
        onClick={onZoomIn}
        data-testid="btn-zoom-in"
        aria-label={t('zoomIn')}
        className="px-4 py-2 bg-transparent border-none text-[18px] font-bold text-slate-900 dark:text-slate-50 cursor-pointer hover:bg-black/10 dark:hover:bg-white/15 transition-colors active:bg-black/15 dark:active:bg-white/25 disabled:opacity-50 disabled:cursor-not-allowed"
        title={t('zoomIn')}
      >
        +
      </button>
    </div>
  );
});
