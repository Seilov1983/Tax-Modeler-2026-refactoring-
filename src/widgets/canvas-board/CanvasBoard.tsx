'use client';

/**
 * CanvasBoard Widget — React Konva-based canvas with multi-layer rendering.
 *
 * Integrates:
 * - Konva <Stage> + <Layer> for GPU-accelerated 2D rendering
 * - Jotai splitAtom for per-node rendering isolation
 * - useCanvasViewport for 60 FPS pan & zoom via Konva Stage
 * - Draft connection line for interactive flow/ownership creation
 * - viewportAtom sync (rAF-throttled) for minimap + zoom controls
 * - Context-aware creation: strict hierarchy Country > Regime > Node
 * - Hierarchical zone nesting via parentId + Konva <Group>
 *
 * Strict 4-layer architecture (from bottom to top):
 *   Layer 1 (static):    Grid background (cached for perf)
 *   Layer 2 (committed):  Zones (hierarchical) + Nodes (isolated re-renders via splitAtom)
 *   Layer 3 (committed):  Flows + Ownership lines (static — re-renders on data change only)
 *   Layer 4 (transient): Draft connection line, lasso, Transformer (60 FPS via useRef + batchDraw)
 *
 * Context menu: rendered as HTML/CSS DOM overlay (not inside Konva) to avoid
 * clipping and zoom scaling. Coordinates stored in Jotai contextMenuAtom.
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer, Rect, Shape, Line, Group, Text } from 'react-konva';
import { nodeAtomsAtom, nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { zonesAtom } from '@entities/zone';
import { ownershipAtom } from '@entities/ownership';
import { CanvasNode, CanvasFlow, useCanvasViewport } from '@features/canvas';
import { CanvasOwnership } from '@features/canvas/ui/CanvasOwnership';
import { CanvasZone } from '@features/canvas/ui/CanvasZone';
import { useKeyboardShortcuts } from '@features/canvas/ui/useKeyboardShortcuts';
import { CanvasControls } from '@features/canvas/ui/CanvasControls';
import { Minimap } from '@features/canvas/ui/Minimap';
import { AuditLogPanel } from '@features/audit-log/ui/AuditLogPanel';
import { FlowModal } from '@features/canvas/ui/FlowModal';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { EditorModal } from '@features/entity-editor/ui/EditorModal';
import { draftConnectionAtom } from '@features/canvas/model/draft-connection-atom';
import { viewportAtom } from '@features/canvas/model/viewport-atom';
import { contextMenuAtom } from '@features/canvas/model/context-menu-atom';
import type { ContextMenuTarget } from '@features/canvas/model/context-menu-atom';
import { buildBezierPath } from '@features/canvas/ui/CanvasFlow';
import { buildVerticalBezierPath } from '@features/canvas/ui/CanvasOwnership';
import { addNodeAtom, addZoneAtom, NODE_WIDTH, NODE_HEIGHT } from '@features/canvas/model/graph-actions-atom';
import { spawnCoordinatesAtom } from '@features/canvas/model/spawn-coordinates-atom';
import { notificationAtom } from '@features/canvas/model/notification-atom';
import { GlobalSummaryWidget } from '@features/analytics-dashboard/ui/GlobalSummaryWidget';
import { CanvasFilterPanel } from './CanvasFilterPanel';
import { isSidebarOpenAtom, sidebarContextAtom } from '@features/master-data-sidebar';
import { pointInZone, zoneArea } from '@shared/lib/engine/engine-core';
import type { JurisdictionCode, CurrencyCode, Zone, NodeDTO } from '@shared/types';
import { useTranslation } from '@shared/lib/i18n';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';

// ─── Shadow Containers (Management Layer — Dual-Track Analysis) ─────────────
// Renders translucent dashed containers on the canvas background layer to
// visually group nodes that share a management tag. Uses flat rendering
// (absolute Stage coordinates) and listening: false to avoid intercepting
// mouse events meant for actual nodes. Z-index < Countries (10).

const TAG_COLORS: Record<number, string> = {
  0: '#6366f1', // indigo
  1: '#8b5cf6', // violet
  2: '#ec4899', // pink
  3: '#f59e0b', // amber
  4: '#10b981', // emerald
};

function ShadowContainers({ nodes }: { nodes: NodeDTO[] }) {
  const groups = useMemo(() => {
    const tagMap = new Map<string, NodeDTO[]>();
    for (const node of nodes) {
      if (!node.managementTags?.length) continue;
      for (const tag of node.managementTags) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag)!.push(node);
      }
    }
    return tagMap;
  }, [nodes]);

  if (groups.size === 0) return null;

  const PAD = 20;
  let colorIdx = 0;

  return (
    <>
      {Array.from(groups.entries()).map(([tag, tagNodes]) => {
        if (tagNodes.length === 0) return null;

        // Compute bounding box spanning all tagged nodes (absolute coordinates)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of tagNodes) {
          minX = Math.min(minX, n.x);
          minY = Math.min(minY, n.y);
          maxX = Math.max(maxX, n.x + n.w);
          maxY = Math.max(maxY, n.y + n.h);
        }

        const x = minX - PAD;
        const y = minY - PAD;
        const w = maxX - minX + PAD * 2;
        const h = maxY - minY + PAD * 2;
        const color = TAG_COLORS[colorIdx % 5] || '#6366f1';
        colorIdx++;

        return (
          <Group key={`shadow-${tag}`} listening={false}>
            <Rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="rgba(255, 255, 255, 0.07)"
              stroke={color}
              strokeWidth={1.5}
              dash={[8, 4]}
              cornerRadius={12}
              listening={false}
            />
            <Text
              x={x + 8}
              y={y + 4}
              text={tag}
              fontSize={11}
              fontFamily="Inter, sans-serif"
              fontStyle="600"
              fill={color}
              opacity={0.8}
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}

// ─── Default sizes for contextual spawning ──────────────────────────────────
const COUNTRY_DEFAULT_W = 400;
const COUNTRY_DEFAULT_H = 250;
const REGIME_DEFAULT_W = 200;
const REGIME_DEFAULT_H = 120;

// ─── Notification Toast ──────────────────────────────────────────────────────

function NotificationToast() {
  const notification = useAtomValue(notificationAtom);
  if (!notification) return null;

  const bgColor = notification.type === 'error' ? 'var(--badge-error-bg, #fef2f2)' : notification.type === 'warning' ? 'var(--badge-warn-bg)' : 'var(--badge-info-bg)';
  const borderColor = notification.type === 'error' ? 'var(--badge-error-text, #dc2626)' : notification.type === 'warning' ? 'var(--badge-warn-text)' : 'var(--badge-info-text)';
  const textColor = notification.type === 'error' ? 'var(--badge-error-text, #dc2626)' : notification.type === 'warning' ? 'var(--badge-warn-text)' : 'var(--badge-info-text)';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: '8px',
        padding: '12px 20px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        fontSize: '13px',
        fontWeight: 500,
        color: textColor,
        maxWidth: '500px',
        textAlign: 'center',
        pointerEvents: 'none',
      }}
    >
      {notification.message}
    </div>
  );
}

// ─── Grid pattern renderer (cached) ─────────────────────────────────────────

const GRID_SIZE = 24;
const GRID_COLOR = 'rgba(0,0,0,0.04)';

function GridBackground({ width, height }: { width: number; height: number }) {
  return (
    <Shape
      sceneFunc={(ctx) => {
        ctx.fillStyle = GRID_COLOR;
        for (let x = 0; x < width; x += GRID_SIZE) {
          for (let y = 0; y < height; y += GRID_SIZE) {
            ctx.beginPath();
            ctx.arc(x, y, 0.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }}
      listening={false}
    />
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function CanvasBoard() {
  const { t } = useTranslation();
  const zones = useAtomValue(zonesAtom);
  const nodeAtoms = useAtomValue(nodeAtomsAtom);
  const nodes = useAtomValue(nodesAtom);
  const flows = useAtomValue(flowsAtom);
  const ownership = useAtomValue(ownershipAtom);

  // ─── Parallel edge bundle detection ─────────────────────────────────
  const flowParallelInfo = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const f of flows) {
      const key = [f.fromId, f.toId].sort().join('::');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(f.id);
    }
    const info = new Map<string, { index: number; count: number }>();
    for (const ids of groups.values()) {
      for (let i = 0; i < ids.length; i++) {
        info.set(ids[i], { index: i, count: ids.length });
      }
    }
    return info;
  }, [flows]);

  const [currentSelection, setSelection] = useAtom(selectionAtom);
  const selectionRef = useRef(currentSelection);
  selectionRef.current = currentSelection;

  useKeyboardShortcuts();
  const addNode = useSetAtom(addNodeAtom);
  const addZone = useSetAtom(addZoneAtom);
  const [draft, setDraft] = useAtom(draftConnectionAtom);
  const setViewport = useSetAtom(viewportAtom);

  // ─── Context menu state (Jotai atom — rendered as DOM overlay) ──────
  const [contextMenu, setContextMenu] = useAtom(contextMenuAtom);
  const setSpawnCoordinates = useSetAtom(spawnCoordinatesAtom);

  // ─── Sidebar state (contextual open/close) ─────────────────────────
  const setIsSidebarOpen = useSetAtom(isSidebarOpenAtom);
  const setSidebarContext = useSetAtom(sidebarContextAtom);

  // ─── Konva Stage ref ──────────────────────────────────────────────────
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 1200, height: 800 });

  // Resize Stage to fill parent <main> — handles window resize AND sidebar squeeze
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      setStageSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };
    updateSize();

    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ─── Force Konva redraw after React commits new entities ────────────────
  // HTML5 drag-and-drop and Jotai atom updates don't trigger Konva's internal
  // draw cycle. This effect fires AFTER React reconciles the new <CanvasNode>
  // into the Konva scene graph, ensuring the layer actually paints.
  const entityCount = nodeAtoms.length + zones.length + flows.length + ownership.length;
  useEffect(() => {
    stageRef.current?.batchDraw();
  }, [entityCount]);

  // ─── Viewport (pan & zoom) ─────────────────────────────────────────────
  const { stateRef: viewportStateRef, zoomBy, panTo, resetViewport } = useCanvasViewport(
    stageRef,
    setViewport,
  );

  const handleZoomIn = useCallback(() => zoomBy(1.25), [zoomBy]);
  const handleZoomOut = useCallback(() => zoomBy(0.8), [zoomBy]);

  // ─── Convert client coords to canvas-space ────────────────────────────
  const clientToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const stage = stageRef.current;
      if (!stage) return { x: clientX, y: clientY };
      const pos = stage.getPointerPosition();
      if (pos) {
        const transform = stage.getAbsoluteTransform().copy().invert();
        return transform.point(pos);
      }
      // Fallback
      const container = stage.container();
      const rect = container.getBoundingClientRect();
      const state = viewportStateRef.current;
      return {
        x: (clientX - rect.left - state.panX) / state.scale,
        y: (clientY - rect.top - state.panY) / state.scale,
      };
    },
    [viewportStateRef],
  );

  // ─── Context menu target detection ─────────────────────────────────────
  const detectClickContext = useCallback(
    (canvasX: number, canvasY: number, screenX: number, screenY: number): ContextMenuTarget => {
      const hitZones = zones.filter((z) => pointInZone(canvasX, canvasY, z));

      if (hitZones.length === 0) {
        return { kind: 'empty', screenX, screenY, canvasX, canvasY };
      }

      hitZones.sort((a, b) => zoneArea(a) - zoneArea(b));
      const smallestZone = hitZones[0];

      // Check if this zone has child sub-zones (country vs regime)
      const isCountry = zones.some((z) => z.parentId === smallestZone.id) ||
        zones.some((z) => {
          if (z.id === smallestZone.id) return false;
          if (zoneArea(z) >= zoneArea(smallestZone)) return false;
          const cx = z.x + z.w / 2;
          const cy = z.y + z.h / 2;
          return pointInZone(cx, cy, smallestZone);
        });

      if (isCountry) {
        return { kind: 'country', screenX, screenY, canvasX, canvasY, zone: smallestZone };
      }

      return { kind: 'regime', screenX, screenY, canvasX, canvasY, zone: smallestZone };
    },
    [zones],
  );

  // ─── Helper: get screen-space pointer position from Stage ──────────────
  const getScreenPointerPosition = useCallback((): { screenX: number; screenY: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    // getPointerPosition() returns coords relative to the Stage container,
    // so we add the container's bounding rect offset to get screen coords.
    const container = stage.container();
    const rect = container.getBoundingClientRect();
    return {
      screenX: pos.x + rect.left,
      screenY: pos.y + rect.top,
    };
  }, []);

  // ─── Stage double-click → open sidebar (empty canvas only) ─────────────
  // Zone double-clicks are handled by CanvasZone.onDblClick with cancelBubble.
  const handleStageDblClick = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;

      e.evt.stopPropagation();
      e.evt.preventDefault();

      // Only trigger on empty canvas (Stage itself)
      if (e.target !== stage) return;

      // Double-click on empty stage → open the MasterData sidebar
      setIsSidebarOpen(true);
    },
    [setIsSidebarOpen],
  );

  // ─── Stage click → deselect + close sidebar ─────────────────────────────
  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      // Only trigger on direct Stage clicks (empty area)
      if (e.target === e.target.getStage()) {
        setSelection(null);
        setContextMenu(null);
        setIsSidebarOpen(false);
      }
    },
    [setSelection, setContextMenu, setIsSidebarOpen],
  );

  // ─── Right-click context menu ────────────────────────────────────────
  const handleContextMenu = useCallback(
    (e: KonvaEventObject<PointerEvent>) => {
      const evt = e.evt;
      evt.preventDefault();
      evt.stopPropagation();

      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const transform = stage.getAbsoluteTransform().copy().invert();
      const canvasPos = transform.point(pos);

      const canvasX = Math.round(canvasPos.x - NODE_WIDTH / 2);
      const canvasY = Math.round(canvasPos.y - NODE_HEIGHT / 2);

      const screen = getScreenPointerPosition();
      if (!screen) return;

      const ctx = detectClickContext(canvasPos.x, canvasPos.y, screen.screenX, screen.screenY);
      setContextMenu({ ...ctx, canvasX, canvasY });
    },
    [detectClickContext, setContextMenu, getScreenPointerPosition],
  );

  // ─── Context menu action handlers ──────────────────────────────────────

  const handleContextMenuCreate = useCallback(
    (type: 'company' | 'person') => {
      if (!contextMenu) return;
      const name = type === 'company' ? 'New Company' : 'New Person';
      const zoneId = (contextMenu.kind === 'regime') ? contextMenu.zone.id : undefined;
      addNode({ type, name, x: contextMenu.canvasX, y: contextMenu.canvasY, zoneId });
      setContextMenu(null);
    },
    [contextMenu, addNode, setContextMenu],
  );

  const handleAddCountryZone = useCallback(() => {
    if (!contextMenu) return;
    // Store spawn coordinates centered at pointer with new default sizes (200×400)
    setSpawnCoordinates({
      x: contextMenu.canvasX - COUNTRY_DEFAULT_W / 2,
      y: contextMenu.canvasY - COUNTRY_DEFAULT_H / 2,
    });
    // Open the sidebar for country selection
    setIsSidebarOpen(true);
    setContextMenu(null);
  }, [contextMenu, setContextMenu, setSpawnCoordinates, setIsSidebarOpen]);

  const handleAddRegimeZone = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'country') return;
    const parentZone = contextMenu.zone;
    // Store spawn coordinates centered at pointer with new default sizes (100×200)
    setSpawnCoordinates({
      x: contextMenu.canvasX - REGIME_DEFAULT_W / 2,
      y: contextMenu.canvasY - REGIME_DEFAULT_H / 2,
      parentZone,
    });
    // Open the sidebar pre-expanded to that country
    setSidebarContext(parentZone.jurisdiction);
    setIsSidebarOpen(true);
    setContextMenu(null);
  }, [contextMenu, setContextMenu, setSpawnCoordinates, setSidebarContext, setIsSidebarOpen]);

  // ─── Drag & Drop from MasterDataSidebar ────────────────────────────────

  const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
    KZ: 'KZT', UAE: 'AED', HK: 'HKD', CY: 'EUR', SG: 'SGD',
    UK: 'GBP', US: 'USD', BVI: 'USD', CAY: 'USD', SEY: 'SCR',
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const stage = stageRef.current;
      if (!stage) return;

      // Sync HTML5 drag pointer into Konva so getPointerPosition() works
      stage.setPointersPositions(e);
      const ptr = stage.getPointerPosition();
      if (!ptr) return;

      // Map screen-relative pointer into canvas-local coordinates via matrix inversion
      const localPos = stage.getAbsoluteTransform().copy().invert().point(ptr);
      const x = localPos.x;
      const y = localPos.y;

      // Entity node drops (Company / Person)
      const companyType = e.dataTransfer.getData('application/tax-node-company');
      const personType = e.dataTransfer.getData('application/tax-node-person');
      if (companyType || personType) {
        const type = companyType ? 'company' : 'person';
        const name = type === 'company' ? 'New Company' : 'New Person';
        addNode({
          type,
          name,
          x: Math.round(x - NODE_WIDTH / 2),
          y: Math.round(y - NODE_HEIGHT / 2),
        });
        return;
      }

      // Regime drop
      const regimeId = e.dataTransfer.getData('application/tax-regime-id');
      const regimeName = e.dataTransfer.getData('application/tax-regime-name');
      const regimeCountryId = e.dataTransfer.getData('application/tax-regime-country-id');

      if (regimeId && regimeCountryId) {
        const parentZone = zones.find((z) => z.jurisdiction === regimeCountryId && !z.parentId);
        // All zone coordinates are ABSOLUTE (flat rendering) — never subtract parent offset
        addZone({
          jurisdiction: regimeCountryId as JurisdictionCode,
          code: `${regimeCountryId}_${regimeId}`,
          name: regimeName || regimeId,
          currency: COUNTRY_CURRENCY[regimeCountryId] || 'USD',
          x: Math.round(x - REGIME_DEFAULT_W / 2),
          y: Math.round(y - REGIME_DEFAULT_H / 2),
          w: REGIME_DEFAULT_W,
          h: REGIME_DEFAULT_H,
          parentId: parentZone?.id ?? null,
        });
        return;
      }

      // Country drop
      const countryId = e.dataTransfer.getData('application/tax-country-id');
      const countryName = e.dataTransfer.getData('application/tax-country-name');
      if (!countryId) return;

      addZone({
        jurisdiction: countryId as JurisdictionCode,
        code: `${countryId}_${Date.now().toString(36).toUpperCase()}`,
        name: countryName || countryId,
        currency: COUNTRY_CURRENCY[countryId] || 'USD',
        x: Math.round(x - COUNTRY_DEFAULT_W / 2),
        y: Math.round(y - COUNTRY_DEFAULT_H / 2),
        w: COUNTRY_DEFAULT_W,
        h: COUNTRY_DEFAULT_H,
        parentId: null,
      });
    },
    [addNode, addZone, zones],
  );

  // ─── Stage pointer up → clear draft if dropped on empty space ────────
  const handleStagePointerUp = useCallback(
    (e: KonvaEventObject<PointerEvent>) => {
      // Only clear draft when pointer lands on empty stage (not on a node)
      if (draft && e.target === e.target.getStage()) {
        setDraft(null);
      }
    },
    [draft, setDraft],
  );

  // ─── Lasso selection — useRef to bypass React reconciliation ─────────
  const lassoStartRef = useRef<{ x: number; y: number } | null>(null);
  const lassoDataRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const lassoKonvaRef = useRef<Konva.Rect>(null);
  const lassoDraggedRef = useRef(false);

  const handleStageMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      // Only start lasso if clicking empty area (Stage itself)
      if (e.target !== e.target.getStage()) return;
      if (e.evt.button !== 0) return;

      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const transform = stage.getAbsoluteTransform().copy().invert();
      const canvasPos = transform.point(pos);

      lassoStartRef.current = canvasPos;
      lassoDraggedRef.current = false;
      lassoDataRef.current = { x: canvasPos.x, y: canvasPos.y, w: 0, h: 0 };
      // Show the lasso rect via direct Konva mutation
      const lr = lassoKonvaRef.current;
      if (lr) {
        lr.setAttrs({ x: canvasPos.x, y: canvasPos.y, width: 0, height: 0, visible: true });
        lr.getLayer()?.batchDraw();
      }

      if (!e.evt.shiftKey) {
        setSelection(null);
      }
    },
    [setSelection],
  );

  const handleStageMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (!lassoStartRef.current) return;

      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const transform = stage.getAbsoluteTransform().copy().invert();
      const current = transform.point(pos);
      const start = lassoStartRef.current;

      const lx = Math.min(start.x, current.x);
      const ly = Math.min(start.y, current.y);
      const lw = Math.abs(current.x - start.x);
      const lh = Math.abs(current.y - start.y);

      if (lw > 5 || lh > 5) {
        lassoDraggedRef.current = true;
      }
      // Mutate ref + Konva node directly — no React re-render
      lassoDataRef.current = { x: lx, y: ly, w: lw, h: lh };
      const lr = lassoKonvaRef.current;
      if (lr) {
        lr.setAttrs({ x: lx, y: ly, width: lw, height: lh });
        lr.getLayer()?.batchDraw();
      }
    },
    [],
  );

  const handleStageMouseUp = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (!lassoStartRef.current) return;

      const rect = lassoDataRef.current;
      lassoStartRef.current = null;
      lassoDataRef.current = null;
      // Hide the lasso rect
      const lr = lassoKonvaRef.current;
      if (lr) {
        lr.setAttrs({ visible: false, width: 0, height: 0 });
        lr.getLayer()?.batchDraw();
      }

      if (!rect || (rect.w < 5 && rect.h < 5)) return;

      const hitIds = nodes
        .filter((n) =>
          n.x < rect.x + rect.w &&
          n.x + n.w > rect.x &&
          n.y < rect.y + rect.h &&
          n.y + n.h > rect.y
        )
        .map((n) => n.id);

      if (hitIds.length === 0) return;

      if (e.evt.shiftKey) {
        const sel = selectionRef.current;
        const existing = sel?.type === 'node' ? sel.ids : [];
        const merged = [...new Set([...existing, ...hitIds])];
        setSelection({ type: 'node', ids: merged });
      } else {
        setSelection({ type: 'node', ids: hitIds });
      }
    },
    [nodes, setSelection],
  );

  // ─── Draft connection (transient Bezier during port drag) ──────────────
  const sourceNode = draft ? nodes.find((n) => n.id === draft.sourceNodeId) : null;
  const isFlowDraft = draft?.connectionType === 'flow';
  const srcX = sourceNode
    ? isFlowDraft ? sourceNode.x + sourceNode.w : sourceNode.x + sourceNode.w / 2
    : 0;
  const srcY = sourceNode
    ? isFlowDraft ? sourceNode.y + sourceNode.h / 2 : sourceNode.y + sourceNode.h
    : 0;

  // Track pointer for draft connection — useRef to bypass React reconciliation
  const draftEndRef = useRef<{ x: number; y: number } | null>(null);
  const draftShapeRef = useRef<Konva.Shape>(null);

  useEffect(() => {
    if (!draft || !sourceNode) {
      draftEndRef.current = null;
      return;
    }

    const onPointerMove = (e: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const container = stage.container();
      const rect = container.getBoundingClientRect();
      const state = viewportStateRef.current;
      // Mutate ref directly — no React re-render
      draftEndRef.current = {
        x: (e.clientX - rect.left - state.panX) / state.scale,
        y: (e.clientY - rect.top - state.panY) / state.scale,
      };
      // Repaint only the transient layer via Konva
      draftShapeRef.current?.getLayer()?.batchDraw();
    };

    const onPointerUp = () => {
      draftEndRef.current = null;
      setDraft(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [draft, sourceNode, viewportStateRef, setDraft]);

  // ─── Build hierarchical zone tree ──────────────────────────────────────
  // Top-level zones: zones without parentId
  const topLevelZones = useMemo(
    () => zones.filter((z) => !z.parentId),
    [zones],
  );

  // Child zones: zones with parentId
  const childZonesByParent = useMemo(() => {
    const map = new Map<string, Zone[]>();
    for (const z of zones) {
      if (z.parentId) {
        const children = map.get(z.parentId) || [];
        children.push(z);
        map.set(z.parentId, children);
      }
    }
    return map;
  }, [zones]);

  return (
    <div
      id="canvas-render-area"
      ref={containerRef}
      className="w-full h-full overflow-hidden relative"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          onClick={handleStageClick}
          onDblClick={handleStageDblClick}
          onContextMenu={handleContextMenu}
          onPointerUp={handleStagePointerUp}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
        >
          {/* Layer 1: Static grid background (cacheable) */}
          <Layer listening={false}>
            <GridBackground width={8000} height={6000} />
          </Layer>

          {/* Layer 2: Committed Zones + Nodes —
              Zones rendered first (below), nodes on top.
              Shadow containers (management tags) rendered first, below zones.
              Hierarchical zone nesting via Konva <Group>. */}
          <Layer>
            {/* Shadow containers for management-layer tag grouping (z < Countries).
                Flat rendering: absolute coords. listening: false (non-interactive). */}
            <ShadowContainers nodes={nodes} />

            {/* Zones rendered flat — all coordinates are absolute.
                moveZoneAtom cascades dx/dy to child zones, so no Konva
                group nesting needed (avoids double-offset).
                Strict z-index ordering: Countries (z=10) → Regimes (z=20) → Nodes (z=30). */}
            {topLevelZones
              .slice()
              .sort((a, b) => (a.zIndex ?? 10) - (b.zIndex ?? 10))
              .map((zone) => (
                <CanvasZone key={zone.id} zone={zone} />
              ))}
            {zones
              .filter((z) => z.parentId)
              .sort((a, b) => (a.zIndex ?? 20) - (b.zIndex ?? 20))
              .map((zone) => (
                <CanvasZone key={zone.id} zone={zone} />
              ))}

            {/* Nodes (each with its own atom for isolated re-renders) */}
            {nodeAtoms.map((nodeAtom) => (
              <CanvasNode key={`${nodeAtom}`} nodeAtom={nodeAtom} />
            ))}
          </Layer>

          {/* Layer 3: Committed Flows + Ownership —
              Static layer, re-renders only on data change.
              Includes hitStrokeWidth={20} on flows for easy selection. */}
          <Layer>
            {flows.map((flow) => {
              const par = flowParallelInfo.get(flow.id);
              return (
                <CanvasFlow
                  key={flow.id}
                  flow={flow}
                  nodes={nodes}
                  parallelIndex={par?.index}
                  parallelCount={par?.count}
                />
              );
            })}

            {ownership.map((edge) => (
              <CanvasOwnership key={edge.id} edge={edge} nodes={nodes} />
            ))}
          </Layer>

          {/* Layer 4: Transient UI (draft connection, lasso, Transformer) —
              Isolated from committed content to avoid repainting 100+ connections
              during 60 FPS pointer move. Only this layer is batchDraw'd. */}
          <Layer>
            {/* Draft connection line — rendered via ref, no React state during pointer move */}
            {draft && sourceNode && (
              <Shape
                ref={draftShapeRef}
                sceneFunc={(ctx, shape) => {
                  const end = draftEndRef.current;
                  if (!end) return;
                  const ex = end.x;
                  const ey = end.y;

                  if (isFlowDraft) {
                    const dx = Math.abs(ex - srcX);
                    const cpOffset = Math.max(dx * 0.45, 50);
                    ctx.beginPath();
                    ctx.moveTo(srcX, srcY);
                    ctx.bezierCurveTo(srcX + cpOffset, srcY, ex - cpOffset, ey, ex, ey);
                  } else {
                    const dy = Math.abs(ey - srcY);
                    const cpOffset = Math.max(dy * 0.45, 50);
                    ctx.beginPath();
                    ctx.moveTo(srcX, srcY);
                    ctx.bezierCurveTo(srcX, srcY + cpOffset, ex, ey - cpOffset, ex, ey);
                  }
                  ctx.strokeShape(shape);
                }}
                stroke={isFlowDraft ? '#3b82f6' : '#a855f7'}
                strokeWidth={2}
                dash={[6, 3]}
                listening={false}
              />
            )}

            {/* Lasso selection rectangle — always mounted, visibility toggled via ref */}
            <Rect
              ref={lassoKonvaRef}
              visible={false}
              stroke="#3b82f6"
              strokeWidth={1}
              fill="rgba(59, 130, 246, 0.1)"
              listening={false}
            />
          </Layer>
        </Stage>

        {/* HTML overlays positioned on top of Konva Stage */}
        <CanvasFilterPanel />
        <GlobalSummaryWidget />
        <CanvasControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onReset={resetViewport} />
        <Minimap onNavigate={panTo} viewportRef={containerRef} />
        <AuditLogPanel />
        <FlowModal />
        <EditorModal />
        <NotificationToast />

        {/* Add Node Menu — Apple Liquid Glass floating popover.
            Rendered as DOM overlay OUTSIDE Konva to avoid canvas clipping.
            Event propagation stopped on all pointer/mouse/touch events to
            prevent underlying Konva zone drag. */}
        {contextMenu && (
          <div
            className="no-canvas-events"
            style={{
              position: 'fixed',
              left: contextMenu.screenX,
              top: contextMenu.screenY,
              zIndex: 9999,
              background: 'var(--glass-bg-heavy)',
              backdropFilter: 'blur(12px) saturate(180%)',
              WebkitBackdropFilter: 'blur(12px) saturate(180%)',
              borderRadius: '16px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
              border: '1px solid var(--glass-border)',
              padding: '6px',
              minWidth: '180px',
              pointerEvents: 'auto',
              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.kind === 'empty' && (
              <button
                onClick={handleAddCountryZone}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  width: '100%', padding: '10px 14px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 500, textAlign: 'left',
                  borderRadius: '10px', color: 'var(--text-primary)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
              >
                <span style={{ fontSize: '15px', lineHeight: 1 }}>+</span>
                <span>{t('country')}</span>
              </button>
            )}

            {contextMenu.kind === 'country' && (
              <button
                onClick={handleAddRegimeZone}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  width: '100%', padding: '10px 14px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 500, textAlign: 'left',
                  borderRadius: '10px', color: 'var(--text-primary)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
              >
                <span style={{ fontSize: '15px', lineHeight: 1 }}>+</span>
                <span>{t('regime')}</span>
              </button>
            )}

            {contextMenu.kind === 'regime' && (
              <>
                <button
                  onClick={() => handleContextMenuCreate('company')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    width: '100%', padding: '10px 14px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '13px', fontWeight: 500, textAlign: 'left',
                    borderRadius: '10px', color: 'var(--text-primary)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                >
                  <span style={{ fontSize: '15px', lineHeight: 1, color: 'var(--color-accent)' }}>+</span>
                  <span>{t('company')}</span>
                </button>
                <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '2px 10px' }} />
                <button
                  onClick={() => handleContextMenuCreate('person')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    width: '100%', padding: '10px 14px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '13px', fontWeight: 500, textAlign: 'left',
                    borderRadius: '10px', color: 'var(--text-primary)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                >
                  <span style={{ fontSize: '15px', lineHeight: 1, color: 'var(--color-success-light)' }}>+</span>
                  <span>{t('person')}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
  );
}
