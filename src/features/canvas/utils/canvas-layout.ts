/**
 * canvas-layout.ts — Pure math functions for computing element coordinates
 * on a Konva canvas.
 *
 * Replaces CSS layout primitives (flexbox space-between, padding, margin)
 * with explicit geometry calculations.
 */

// ─── Zone Header Layout ─────────────────────────────────────────────────────

export interface ZoneLayoutConfig {
  width: number;
  padding?: number;
}

export interface ZoneHeaderLayout {
  title: { x: number; y: number; width: number };
  badge: { x: number; y: number; width: number };
  closeIcon: { x: number; y: number; width: number };
}

/**
 * Compute x/y/width for zone header elements (title, badge, close icon).
 * Mimics `justify-content: space-between` with explicit math.
 */
export const calculateZoneHeaderLayout = ({
  width,
  padding = 16,
}: ZoneLayoutConfig): ZoneHeaderLayout => {
  const iconSize = 24;
  const badgeWidth = 100;

  return {
    title: {
      x: padding,
      y: padding,
      width: width - badgeWidth - iconSize - padding * 3,
    },
    badge: {
      x: width - padding - iconSize - padding - badgeWidth,
      y: padding,
      width: badgeWidth,
    },
    closeIcon: {
      x: width - padding - iconSize,
      y: padding,
      width: iconSize,
    },
  };
};

// ─── Node Card Layout ────────────────────────────────────────────────────────

export interface NodeCardLayout {
  background: { width: number; height: number };
  title: { x: number; y: number; width: number };
  subtitle: { x: number; y: number; width: number };
}

/**
 * Compute x/y/width for node card elements (background, title, subtitle).
 * Replaces CSS padding with explicit coordinate offsets.
 */
export const calculateNodeCardLayout = (
  width: number,
  height: number,
  padding: number = 12,
): NodeCardLayout => {
  return {
    background: { width, height },
    title: { x: padding, y: padding, width: width - padding * 2 },
    subtitle: { x: padding, y: padding + 20, width: width - padding * 2 },
  };
};
