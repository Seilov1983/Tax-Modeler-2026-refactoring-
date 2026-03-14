'use client';

/**
 * Minimap — schematic bird's-eye overview of all nodes + viewport indicator.
 *
 * Nodes are rendered as tiny colored rectangles. The current viewport is shown
 * as a blue translucent frame. Click anywhere on the minimap to pan the canvas
 * to that location.
 *
 * PERF: Reads from viewportAtom (rAF-throttled) and nodesAtom (granular).
 * No heavy SVG — just absolute-positioned divs.
 */

import { useAtomValue } from 'jotai';
import { memo, useCallback, useRef } from 'react';
import { nodesAtom } from '@entities/node';
import { viewportAtom } from '../model/viewport-atom';

const MINIMAP_W = 160;
const MINIMAP_H = 120;
const PADDING = 20;

interface MinimapProps {
  /** Called when user clicks on the minimap to navigate */
  onNavigate: (panX: number, panY: number) => void;
  /** Ref to the viewport DOM element for measuring its size */
  viewportRef: React.RefObject<HTMLDivElement | null>;
}

export const Minimap = memo(function Minimap({ onNavigate, viewportRef }: MinimapProps) {
  const nodes = useAtomValue(nodesAtom);
  const viewport = useAtomValue(viewportAtom);
  const minimapRef = useRef<HTMLDivElement>(null);

  // Compute bounding box of all nodes to normalize coordinates into the minimap
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.w > maxX) maxX = n.x + n.w;
    if (n.y + n.h > maxY) maxY = n.y + n.h;
  }

  // If no nodes, show empty minimap
  if (!isFinite(minX)) {
    minX = 0; minY = 0; maxX = 1000; maxY = 800;
  }

  // Add padding around bounds
  minX -= PADDING;
  minY -= PADDING;
  maxX += PADDING;
  maxY += PADDING;

  const worldW = maxX - minX;
  const worldH = maxY - minY;

  // Scale to fit minimap, preserving aspect ratio
  const scaleX = MINIMAP_W / worldW;
  const scaleY = MINIMAP_H / worldH;
  const mapScale = Math.min(scaleX, scaleY);

  // Map world coords → minimap coords
  const toMapX = (wx: number) => (wx - minX) * mapScale;
  const toMapY = (wy: number) => (wy - minY) * mapScale;

  // Viewport indicator: visible area in world coords
  const vpEl = viewportRef.current;
  const vpW = vpEl ? vpEl.clientWidth : 1000;
  const vpH = vpEl ? vpEl.clientHeight : 800;

  const visibleX = -viewport.panX / viewport.scale;
  const visibleY = -viewport.panY / viewport.scale;
  const visibleW = vpW / viewport.scale;
  const visibleH = vpH / viewport.scale;

  // Click on minimap → navigate
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = minimapRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Where did the user click in world coords?
      const clickMapX = e.clientX - rect.left;
      const clickMapY = e.clientY - rect.top;
      const worldClickX = clickMapX / mapScale + minX;
      const worldClickY = clickMapY / mapScale + minY;

      // Center the viewport on that world position
      const newPanX = -(worldClickX - visibleW / 2) * viewport.scale;
      const newPanY = -(worldClickY - visibleH / 2) * viewport.scale;
      onNavigate(newPanX, newPanY);
    },
    [mapScale, minX, minY, visibleW, visibleH, viewport.scale, onNavigate],
  );

  return (
    <div
      ref={minimapRef}
      className="exclude-from-export"
      data-testid="canvas-minimap"
      onClick={handleClick}
      style={{
        position: 'absolute',
        bottom: 52,
        right: 16,
        width: MINIMAP_W,
        height: MINIMAP_H,
        background: '#f9fafb',
        border: '1px solid #d1d5db',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        borderRadius: '6px',
        overflow: 'hidden',
        zIndex: 40,
        cursor: 'crosshair',
      }}
    >
      {/* Node dots */}
      {nodes.map((node) => (
        <div
          key={node.id}
          style={{
            position: 'absolute',
            left: toMapX(node.x),
            top: toMapY(node.y),
            width: Math.max(node.w * mapScale, 3),
            height: Math.max(node.h * mapScale, 2),
            background:
              node.type === 'company'
                ? '#3b82f6'
                : node.type === 'person'
                  ? '#22c55e'
                  : '#94a3b8',
            borderRadius: '1px',
            opacity: 0.7,
          }}
        />
      ))}

      {/* Viewport indicator */}
      <div
        style={{
          position: 'absolute',
          left: toMapX(visibleX),
          top: toMapY(visibleY),
          width: visibleW * mapScale,
          height: visibleH * mapScale,
          border: '1.5px solid #3b82f6',
          background: 'rgba(59, 130, 246, 0.08)',
          borderRadius: '2px',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});
