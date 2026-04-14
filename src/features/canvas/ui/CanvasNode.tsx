'use client';

/**
 * CanvasNode — Konva-based node rendering.
 *
 * Architecture:
 * - Uses Konva <Group> with draggable for built-in drag-and-drop
 * - Transient drag: useRef for intermediate state, no React re-renders during drag
 * - On drop (onDragEnd): final position committed to Jotai atom
 * - Connection ports (flow + ownership) rendered as Konva <Circle>
 * - No dragBoundFunc — free dragging to avoid conflicts with canvas pan/zoom
 *
 * For node types: Konva <Rect>, <Text>, <Circle> replace the DOM elements.
 * Events use KonvaEventObject for proper typing.
 *
 * Layout: Uses calculateNodeCardLayout for explicit padding math
 * (Canvas has no CSS padding — offsets are computed manually).
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { useRef, useCallback, memo, useMemo, useState } from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import { useSpring, animated } from '@react-spring/konva';
import type { PrimitiveAtom } from 'jotai';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { NodeDTO, Zone } from '@shared/types';
import { selectionAtom, nodeEditingAtom } from '@features/entity-editor/model/atoms';
import { canvasFilterAtom } from '../model/canvas-filter-atom';
import { draftConnectionAtom, commitDraftConnectionAtom } from '../model/draft-connection-atom';
import { moveNodesAtom, reparentNodeAtom, flagNodeErrorAtom } from '../model/graph-actions-atom';
import { showNotificationAtom } from '../model/notification-atom';
import { zonesAtom } from '@entities/zone';
import { settingsAtom } from '@features/settings';
import { nodeLiveCITAtomFamily } from '@features/tax-calculator/model/atoms';
import { calculateNodeCardLayout } from '../utils/canvas-layout';
import { fmtMoney, fmtPercent } from '@shared/lib/engine/utils';

// ─── Constants ──────────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; header: string }> = {
  company: { bg: '#ffffff', border: '#007aff', header: '#f0f5ff' },
  person: { bg: '#ffffff', border: '#30d158', header: '#f0fdf4' },
  txa: { bg: '#fafafa', border: '#98989d', header: '#f5f5f7' },
};

// ─── Dark Mode: muted fills + neon strokes for Konva (no Tailwind on canvas) ─
const NODE_COLORS_DARK: Record<string, { bg: string; border: string; header: string }> = {
  company: { bg: '#1a1b2e', border: '#60a5fa', header: '#1a2540' },
  person: { bg: '#1a1b2e', border: '#4ade80', header: '#1a2e1a' },
  txa: { bg: '#1a1b2e', border: '#71717a', header: '#252530' },
};

const TYPE_BADGES: Record<string, string> = {
  company: 'CO',
  person: 'P',
  txa: 'TXA',
};

const HEADER_HEIGHT = 28;
const PORT_RADIUS = 6;
const NODE_PADDING = 10;

// ─── Tax Health Glow ─────────────────────────────────────────────────────────
// Two severities — critical (red) and warning (amber). Matches the risk-flag
// taxonomy emitted by engine-risks.ts so the canvas surfaces compliance state
// without the user having to open the editor sidebar.
const CRITICAL_RISK_TYPES = new Set<string>([
  'SUBSTANCE_BREACH',
  'CFC_RISK',
  'AIFC_PRESENCE_BREACH',
  'PILLAR2_LOW_ETR',
]);
const WARNING_RISK_TYPES = new Set<string>([
  'CAPITAL_ANOMALY',
  'SUBSTANCE_EXPENSE_MISMATCH',
  'TRANSFER_PRICING_RISK',
  'NON_DEDUCTIBLE_EXPENSE',
]);
const CRITICAL_GLOW_COLOR = '#ff3b30'; // Apple red
const WARNING_GLOW_COLOR = '#f59e0b'; // Amber

// ─── Component ──────────────────────────────────────────────────────────────

interface CanvasNodeProps {
  nodeAtom: PrimitiveAtom<NodeDTO>;
}

export const CanvasNode = memo(function CanvasNode({ nodeAtom }: CanvasNodeProps) {
  const node = useAtomValue(nodeAtom);
  const selection = useAtomValue(selectionAtom);
  const setSelection = useSetAtom(selectionAtom);
  const setNodeEditing = useSetAtom(nodeEditingAtom);
  const setDraft = useSetAtom(draftConnectionAtom);
  const commitDraft = useSetAtom(commitDraftConnectionAtom);
  const moveNodes = useSetAtom(moveNodesAtom);
  const reparentNode = useSetAtom(reparentNodeAtom);
  const flagNodeError = useSetAtom(flagNodeErrorAtom);
  const showNotification = useSetAtom(showNotificationAtom);
  const allZones = useAtomValue(zonesAtom);
  const settings = useAtomValue(settingsAtom);
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const nodeTax = useAtomValue(nodeLiveCITAtomFamily(node.id));
  const canvasFilter = useAtomValue(canvasFilterAtom);

  // ─── Ghosting: declarative match against active filters ────────────
  const isGhosted = useMemo(() => {
    if (!canvasFilter.isActive) return false;
    const { managementTags, zoneIds } = canvasFilter;
    const noTagFilter = managementTags.length === 0;
    const noZoneFilter = zoneIds.length === 0;
    // If no filters are set at all, nothing is ghosted
    if (noTagFilter && noZoneFilter) return false;
    // Node matches if it passes ALL active filter dimensions
    const tagMatch = noTagFilter || (node.managementTags ?? []).some((t) => managementTags.includes(t));
    const zoneMatch = noZoneFilter || (node.zoneId != null && zoneIds.includes(node.zoneId));
    return !(tagMatch && zoneMatch);
  }, [canvasFilter, node.managementTags, node.zoneId]);

  const groupRef = useRef<Konva.Group>(null);
  const hasDragged = useRef(false);
  const isDblClickGuard = useRef(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // ─── Entrance animation — subtle scale-in bypassing React render cycle
  const [hasAnimated] = useState(() => ({ value: false }));
  const entranceSpring = useSpring({
    from: hasAnimated.value ? { s: 1, o: isGhosted ? 0.15 : 1 } : { s: 0.8, o: 0 },
    to: { s: 1, o: isGhosted ? 0.15 : 1 },
    config: { tension: 300, friction: 30 },
    onChange: (e) => {
      if (groupRef.current) {
        groupRef.current.scaleX(e.value.s);
        groupRef.current.scaleY(e.value.s);
        groupRef.current.opacity(e.value.o);
        groupRef.current.getLayer()?.batchDraw();
      }
    },
    onRest: () => { hasAnimated.value = true; },
  });

  const isSelected = selection?.type === 'node' && selection.ids.includes(node.id);
  const isTxa = node.type === 'txa';
  const colors = isDark ? (NODE_COLORS_DARK[node.type] || NODE_COLORS_DARK.company) : (NODE_COLORS[node.type] || NODE_COLORS.company);
  const riskCount = node.riskFlags?.length || 0;

  // ─── Tactile interaction: scale ~1.05 on drag/hover, spring-back to 1 on rest.
  // Applied imperatively via Konva refs so we bypass React render cycles for
  // 60 FPS feel without breaking the flat-rendering contract.
  const [isHovering, setIsHovering] = useState(false);
  const [isDraggingNow, setIsDraggingNow] = useState(false);
  const interactionTarget = isDraggingNow ? 1.06 : isHovering ? 1.03 : 1;
  useSpring({
    scale: interactionTarget,
    config: { tension: 300, friction: 30 },
    onChange: ({ value }) => {
      // Only apply the interaction scale once the entrance animation has settled;
      // otherwise we fight entranceSpring over the same scaleX/scaleY attributes.
      if (!hasAnimated.value || !groupRef.current) return;
      groupRef.current.scaleX(value.scale);
      groupRef.current.scaleY(value.scale);
      groupRef.current.getLayer()?.batchDraw();
    },
  });

  const handleMouseEnter = useCallback(() => {
    if (!isTxa && !isGhosted) setIsHovering(true);
  }, [isTxa, isGhosted]);
  const handleMouseLeave = useCallback(() => setIsHovering(false), []);

  // ─── Tax Health: classify the strongest risk flag on this node ─────────
  const riskSeverity: 'critical' | 'warning' | null = useMemo(() => {
    if (!node.riskFlags?.length) return null;
    for (const f of node.riskFlags) {
      if (CRITICAL_RISK_TYPES.has(f.type)) return 'critical';
    }
    for (const f of node.riskFlags) {
      if (WARNING_RISK_TYPES.has(f.type)) return 'warning';
    }
    return null;
  }, [node.riskFlags]);

  // ─── Glow style resolved once per render — error & frozen keep priority
  const healthGlow = useMemo(() => {
    if (node.hasError) {
      return { color: CRITICAL_GLOW_COLOR, blur: 16, opacity: 0.3 };
    }
    if (node.frozen) {
      return { color: CRITICAL_GLOW_COLOR, blur: 12, opacity: 0.2 };
    }
    if (riskSeverity === 'critical') {
      return { color: CRITICAL_GLOW_COLOR, blur: 22, opacity: 0.38 };
    }
    if (riskSeverity === 'warning') {
      return { color: WARNING_GLOW_COLOR, blur: 18, opacity: 0.32 };
    }
    return { color: 'rgba(0,0,0,0.06)', blur: 8, opacity: 0.2 };
  }, [node.hasError, node.frozen, riskSeverity]);

  // ─── Layout math (replaces CSS padding) ──────────────────────────────
  const cardLayout = useMemo(
    () => calculateNodeCardLayout(node.w, node.h, NODE_PADDING),
    [node.w, node.h],
  );

  // ─── Drag handlers ────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      if (isTxa || isDblClickGuard.current) {
        e.target.stopDrag();
        return;
      }
      hasDragged.current = false;
      setIsDraggingNow(true);

      // Store original positions on all selected siblings for accurate bulk drag
      const sel = selectionRef.current;
      if (sel?.type === 'node' && sel.ids.length > 1 && sel.ids.includes(node.id)) {
        const stage = e.target.getStage();
        if (stage) {
          for (const id of sel.ids) {
            if (id === node.id) continue;
            const sibling = stage.findOne(`#node-${id}`) as Konva.Group | undefined;
            if (sibling) {
              sibling.setAttr('data-orig-x', sibling.x());
              sibling.setAttr('data-orig-y', sibling.y());
            }
          }
        }
      }
    },
    [isTxa, node.id],
  );

  const handleDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      hasDragged.current = true;

      // Bulk drag: move selected siblings via direct Konva position updates
      const sel = selectionRef.current;
      if (sel?.type === 'node' && sel.ids.length > 1 && sel.ids.includes(node.id)) {
        const stage = e.target.getStage();
        if (!stage) return;
        const dx = e.target.x() - node.x;
        const dy = e.target.y() - node.y;
        for (const id of sel.ids) {
          if (id === node.id) continue;
          const sibling = stage.findOne(`#node-${id}`) as Konva.Group | undefined;
          if (sibling) {
            // Read the original position from stored data
            const origX = sibling.getAttr('data-orig-x') ?? sibling.x();
            const origY = sibling.getAttr('data-orig-y') ?? sibling.y();
            sibling.position({ x: origX + dx, y: origY + dy });
          }
        }
      }
    },
    [node.id, node.x, node.y],
  );

  // ─── Spatial validation: global hit-test across ALL regimes ──────────────
  // A node can be moved to ANY regime (cross-zone transfer / change of tax residency).
  // It is only an error if the node is outside ALL regimes.
  // ALL coordinates (zones AND nodes) are ABSOLUTE — flat rendering, no Konva group nesting.
  const validateAndReparentNode = useCallback(
    (nodeX: number, nodeY: number, nodeW: number, nodeH: number, nodeId: string) => {
      // Regimes are zones with a parentId (children of countries).
      const regimes = allZones.filter((z) => z.parentId);

      // All zone coordinates are absolute (flat rendering) — no parent offset needed.
      // Node coordinates are also absolute — Konva Group x/y = node.x/y directly.
      // Check if node's bounding box is fully contained within any regime.
      let containingRegime: Zone | null = null;
      for (const regime of regimes) {
        const fullyContained =
          nodeX >= regime.x &&
          nodeY >= regime.y &&
          (nodeX + nodeW) <= (regime.x + regime.w) &&
          (nodeY + nodeH) <= (regime.y + regime.h);
        if (fullyContained) {
          // Prefer the smallest containing regime (most specific)
          if (!containingRegime) {
            containingRegime = regime;
          } else {
            const currentArea = containingRegime.w * containingRegime.h;
            const candidateArea = regime.w * regime.h;
            if (candidateArea < currentArea) {
              containingRegime = regime;
            }
          }
        }
      }

      if (containingRegime) {
        // Node is inside a valid regime — clear any error
        flagNodeError({ id: nodeId, hasError: false });
        // If the regime is different from the current one, re-parent the node
        if (containingRegime.id !== node.zoneId) {
          reparentNode({ id: nodeId, newParentId: containingRegime.id });
        }
      } else {
        // Node is outside ALL regimes — flag error
        flagNodeError({ id: nodeId, hasError: true });
        showNotification({
          message: 'Invalid placement: Companies and Persons must reside within a valid Tax Regime.',
          type: 'error',
        });
      }
    },
    [allZones, node.zoneId, flagNodeError, reparentNode, showNotification],
  );

  const handleDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      setIsDraggingNow(false);
      if (!hasDragged.current) return;

      const target = e.target;
      const x = Math.round(target.x());
      const y = Math.round(target.y());

      const sel = selectionRef.current;
      const isBulk = sel?.type === 'node' && sel.ids.length > 1 && sel.ids.includes(node.id);

      if (isBulk) {
        const stage = target.getStage();
        const dx = x - node.x;
        const dy = y - node.y;
        const entries = sel.ids.map((id) => {
          if (id === node.id) return { id, x, y };
          const sibling = stage?.findOne(`#node-${id}`) as Konva.Group | undefined;
          if (sibling) {
            const pos = { id, x: Math.round(sibling.x()), y: Math.round(sibling.y()) };
            // Clean up transient attrs
            sibling.setAttr('data-orig-x', undefined);
            sibling.setAttr('data-orig-y', undefined);
            return pos;
          }
          return { id, x: node.x + dx, y: node.y + dy };
        });
        moveNodes(entries);
      } else {
        moveNodes([{ id: node.id, x, y }]);
      }

      // Spatial validation: global hit-test across all regimes (cross-zone transfers allowed)
      validateAndReparentNode(x, y, node.w, node.h, node.id);
    },
    [node.id, node.x, node.y, node.w, node.h, moveNodes, validateAndReparentNode],
  );

  // ─── Click to select (single click only selects — does NOT open editor) ──
  const handleClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (hasDragged.current) return;
      e.cancelBubble = true;

      const evt = e.evt;
      const sel = selectionRef.current;
      if (evt.shiftKey) {
        if (sel?.type === 'node') {
          const exists = sel.ids.includes(node.id);
          const newIds = exists
            ? sel.ids.filter((id) => id !== node.id)
            : [...sel.ids, node.id];
          setSelection(newIds.length > 0 ? { type: 'node', ids: newIds } : null);
        } else {
          setSelection({ type: 'node', ids: [node.id] });
        }
      } else {
        // Single click: only select without opening editor
        // (editor opens on double-click)
        const currentSel = selectionRef.current;
        const alreadySelected = currentSel?.type === 'node' && currentSel.ids.length === 1 && currentSel.ids[0] === node.id;
        if (!alreadySelected) {
          setSelection({ type: 'node', ids: [node.id] });
        }
      }
    },
    [node.id, setSelection],
  );

  // ─── Double-click to open editor ──────────────────────────────────────
  const handleDblClick = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      e.evt.stopPropagation();

      // Stop any in-flight drag
      isDblClickGuard.current = true;
      const group = groupRef.current;
      if (group) {
        group.stopDrag();
        group.position({ x: node.x, y: node.y });
        group.getLayer()?.batchDraw();
      }

      // Select node + open the EditorModal
      setSelection({ type: 'node', ids: [node.id] });
      setNodeEditing(true);

      setTimeout(() => { isDblClickGuard.current = false; }, 0);
    },
    [node.id, node.x, node.y, setSelection, setNodeEditing],
  );

  // ─── Flow port (right edge, blue) ─────────────────────────────────────
  const handleFlowPortDown = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      setDraft({ sourceNodeId: node.id, connectionType: 'flow' });
    },
    [node.id, setDraft],
  );

  // ─── Ownership port (bottom edge, purple) ─────────────────────────────
  const handleOwnershipPortDown = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      setDraft({ sourceNodeId: node.id, connectionType: 'ownership' });
    },
    [node.id, setDraft],
  );

  // ─── Drop target: complete connection ──────────────────────────────────
  // Uses commitDraftConnectionAtom (action atom) which reads draft state
  // internally — CanvasNode does NOT subscribe to draftConnectionAtom,
  // avoiding re-renders when a port drag starts/ends on any node.
  const handleNodePointerUp = useCallback(
    (e: KonvaEventObject<PointerEvent>) => {
      e.cancelBubble = true;
      commitDraft(node.id);
    },
    [node.id, commitDraft],
  );

  // Build badge text
  const badges: string[] = [];
  if (node.frozen) badges.push('FROZEN');
  if (riskCount > 0) badges.push(`${riskCount} risk${riskCount > 1 ? 's' : ''}`);

  return (
    <Group
      ref={groupRef}
      id={`node-${node.id}`}
      x={node.x}
      y={node.y}
      draggable={!isTxa && !isGhosted}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onDblClick={handleDblClick}
      onPointerUp={handleNodePointerUp}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      scaleX={hasAnimated.value ? 1 : 0.8}
      scaleY={hasAnimated.value ? 1 : 0.8}
      opacity={hasAnimated.value ? (isGhosted ? 0.15 : 1) : 0}
      listening={!isGhosted}
    >
      {/* Node body — health glow resolved upstream (error → frozen → risk) */}
      <Rect
        width={cardLayout.background.width}
        height={cardLayout.background.height}
        fill={colors.bg}
        stroke={
          node.hasError
            ? CRITICAL_GLOW_COLOR
            : isSelected
              ? (isDark ? '#60a5fa' : '#007aff')
              : node.frozen
                ? CRITICAL_GLOW_COLOR
                : riskSeverity === 'critical'
                  ? CRITICAL_GLOW_COLOR
                  : riskSeverity === 'warning'
                    ? WARNING_GLOW_COLOR
                    : colors.border
        }
        strokeWidth={node.hasError || riskSeverity === 'critical' ? 2 : isSelected ? 2 : node.frozen || riskSeverity === 'warning' ? 1.5 : 1}
        cornerRadius={12}
        shadowColor={healthGlow.color}
        shadowBlur={healthGlow.blur}
        shadowOffsetY={node.hasError || riskSeverity ? 0 : 2}
        shadowOpacity={healthGlow.opacity}
      />

      {/* Header background */}
      <Rect
        width={cardLayout.background.width}
        height={HEADER_HEIGHT}
        fill={colors.header}
        cornerRadius={[12, 12, 0, 0]}
        listening={false}
      />

      {/* Type badge — offset by padding */}
      <Text
        x={cardLayout.title.x}
        y={cardLayout.title.y - 3}
        text={TYPE_BADGES[node.type] || 'N'}
        fontSize={10}
        fontStyle="bold"
        fill={colors.border}
        listening={false}
      />

      {/* Node name — offset by padding, width constrained to prevent overflow */}
      <Text
        x={cardLayout.title.x + 25}
        y={cardLayout.title.y - 3}
        text={node.name}
        fontSize={12}
        fontStyle="600"
        fill={isDark ? '#f1f5f9' : '#1d1d1f'}
        width={cardLayout.title.width - 25}
        ellipsis={true}
        wrap="none"
        listening={false}
      />

      {/* Badges row below header — offset by padding */}
      {badges.length > 0 && (
        <Text
          x={cardLayout.title.x}
          y={HEADER_HEIGHT + 6}
          text={badges.join('  \u00b7  ')}
          fontSize={10}
          fill={node.frozen ? '#ff3b30' : '#ff9f0a'}
          fontStyle="bold"
          width={cardLayout.title.width}
          wrap="none"
          ellipsis={true}
          listening={false}
        />
      )}

      {/* Live tax: CIT amount + ETR — only for company nodes with income */}
      {nodeTax && nodeTax.taxableIncome > 0 && (
        <Text
          x={cardLayout.title.x}
          y={node.h - NODE_PADDING - 12}
          text={`CIT ${fmtMoney(nodeTax.citAmount)}  ·  ETR ${fmtPercent(nodeTax.citRate, 1)}`}
          fontSize={10}
          fontStyle="500"
          fill={nodeTax.citRate > 0.20 ? '#dc2626' : nodeTax.citRate > 0.10 ? '#d97706' : '#16a34a'}
          width={cardLayout.title.width}
          wrap="none"
          ellipsis={true}
          listening={false}
        />
      )}

      {/* Risk badges: CFC (coral-red), PILLAR2 (coral-red), TP (amber) */}
      {(() => {
        const badges: Array<{ label: string; color: string; bg: string }> = [];
        if (node.riskFlags?.some((r) => r.type === 'CFC_RISK'))
          badges.push({ label: 'CFC', color: '#ff453a', bg: 'rgba(255,69,58,0.1)' });
        if (node.riskFlags?.some((r) => r.type === 'PILLAR2_LOW_ETR'))
          badges.push({ label: 'P2', color: '#ff453a', bg: 'rgba(255,69,58,0.1)' });
        if (node.riskFlags?.some((r) => r.type === 'TRANSFER_PRICING_RISK'))
          badges.push({ label: 'TP', color: '#ff9f0a', bg: 'rgba(255,159,10,0.1)' });
        if (!badges.length) return null;
        const badgeW = 26;
        const gap = 2;
        return badges.map((b, i) => (
          <Group key={b.label} x={node.w - NODE_PADDING - (badges.length - i) * (badgeW + gap)} y={HEADER_HEIGHT + 4} listening={false}>
            <Rect width={badgeW} height={14} fill={b.bg} cornerRadius={5} stroke={b.color} strokeWidth={0.5} />
            <Text x={3} y={2} text={b.label} fontSize={9} fontStyle="bold" fill={b.color} />
          </Group>
        ));
      })()}

      {/* Flow out port (right edge, blue) — unlimited outgoing flows */}
      {!isTxa && (
        <Circle
          x={node.w}
          y={node.h / 2}
          radius={PORT_RADIUS}
          fill={isDark ? '#60a5fa' : '#007aff'}
          stroke={isDark ? '#1a1b2e' : '#ffffff'}
          strokeWidth={2}
          onMouseDown={handleFlowPortDown}
          onTouchStart={handleFlowPortDown}
        />
      )}

      {/* Flow in port (left edge, blue outline) — unlimited incoming flows */}
      {!isTxa && (
        <Circle
          x={0}
          y={node.h / 2}
          radius={PORT_RADIUS}
          fill={isDark ? '#1a1b2e' : '#ffffff'}
          stroke={isDark ? '#60a5fa' : '#007aff'}
          strokeWidth={2}
          listening={true}
        />
      )}

      {/* Ownership port (bottom edge, purple) — unlimited ownership edges */}
      {!isTxa && (
        <Circle
          x={node.w / 2}
          y={node.h}
          radius={PORT_RADIUS}
          fill={isDark ? '#c084fc' : '#bf5af2'}
          stroke={isDark ? '#1a1b2e' : '#ffffff'}
          strokeWidth={2}
          onMouseDown={handleOwnershipPortDown}
          onTouchStart={handleOwnershipPortDown}
        />
      )}
    </Group>
  );
});
