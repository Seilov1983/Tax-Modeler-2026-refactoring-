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
      className="exclude-from-export"
      data-testid="canvas-controls"
      style={{
        position: 'absolute',
        bottom: 52,
        left: 16,
        display: 'flex',
        background: 'rgba(255, 255, 255, 0.72)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.25)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
        borderRadius: '14px',
        overflow: 'hidden',
        zIndex: 40,
        userSelect: 'none',
      }}
    >
      <button
        onClick={onZoomOut}
        data-testid="btn-zoom-out"
        style={btnStyle}
        title="Zoom Out"
      >
        &minus;
      </button>

      <div
        onClick={handleReset}
        title="Reset zoom (double-click canvas)"
        style={{
          padding: '6px 12px',
          fontSize: '12px',
          fontFamily: '-apple-system, BlinkMacSystemFont, monospace',
          fontWeight: 600,
          color: '#86868b',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: '52px',
          borderLeft: '1px solid rgba(0,0,0,0.05)',
          borderRight: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        {percent}%
      </div>

      <button
        onClick={onZoomIn}
        data-testid="btn-zoom-in"
        style={btnStyle}
        title="Zoom In"
      >
        +
      </button>
    </div>
  );
});

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: 'none',
  border: 'none',
  fontSize: '16px',
  fontWeight: 600,
  color: '#1d1d1f',
  cursor: 'pointer',
  lineHeight: 1,
  transition: 'background 0.15s',
};
