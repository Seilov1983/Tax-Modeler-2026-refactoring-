'use client';

/**
 * CanvasControls — Zoom In / Zoom Out / Fit buttons + zoom percentage display.
 *
 * Reads zoom level from viewportAtom (throttled mirror of the imperative ref).
 * Zoom actions call imperative methods on useCanvasViewport via callbacks.
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
        background: '#fff',
        border: '1px solid #d1d5db',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        borderRadius: '6px',
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
          padding: '4px 10px',
          fontSize: '12px',
          fontFamily: 'monospace',
          color: '#6b7280',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: '52px',
          borderLeft: '1px solid #e5e7eb',
          borderRight: '1px solid #e5e7eb',
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
  padding: '4px 10px',
  background: 'none',
  border: 'none',
  fontSize: '16px',
  fontWeight: 700,
  color: '#374151',
  cursor: 'pointer',
  lineHeight: 1,
};
