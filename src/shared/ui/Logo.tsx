/**
 * TSM26 "Infinity What-If" Brand Mark — final vectorized form.
 *
 * Horizontal 2:1 orthogonal infinity traced directly from the Client-approved
 * reference (TSM_logo.png). Pure 90-degree geometry for the main silhouette
 * plus a slate "belt + X" overlay at the central waist, matching the
 * reference's duotone palette.
 *
 * Geometry (viewBox 0 0 32 16):
 *   • Outer figure-8 — a single closed orthogonal path with a pinched waist
 *     between x=14 and x=18. Apple Blue (#007aff), the system primary.
 *   • Left / right lobes each contain a nested octagon signalling the
 *     circuit-like internal routing of the reference.
 *   • Slate overlay (text-slate-700 / dark:text-slate-200):
 *       – horizontal "belt" across the midline (y=8)
 *       – diagonal X inside the waist (14→18 / 18→14) — the "A* crossover".
 *
 * The component accepts `className`, so callers control size and effects
 * (`w-6 h-6`, `w-4 h-4 animate-pulse`, `opacity-5 dark:opacity-10`, etc.).
 * The 32×16 viewBox preserves aspect in square containers (logo fills width,
 * pads top/bottom) and keeps strokes pixel-aligned at common sizes.
 */
import * as React from 'react';

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  /** Tailwind / CSS classes — e.g. `w-6 h-6`, `opacity-5 dark:opacity-10`, `animate-pulse`. */
  className?: string;
}

export function Logo({ className, ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 16"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {/* Primary orthogonal figure-8 silhouette — Apple Blue */}
      <path
        d="M2 4 H6 V2 H11 V4 H14 V6 H18 V4 H21 V2 H26 V4 H30 V12 H26 V14 H21 V12 H18 V10 H14 V12 H11 V14 H6 V12 H2 Z"
        stroke="#007aff"
        strokeWidth={2}
      />
      {/* Left lobe nested octagon */}
      <path
        d="M5 6 H7 V4 H10 V6 H12 V10 H10 V12 H7 V10 H5 Z"
        stroke="#007aff"
        strokeWidth={1.25}
      />
      {/* Right lobe nested octagon */}
      <path
        d="M20 6 H22 V4 H25 V6 H27 V10 H25 V12 H22 V10 H20 Z"
        stroke="#007aff"
        strokeWidth={1.25}
      />
      {/* Secondary slate overlay — horizontal belt + central A* crossover X */}
      <g
        className="text-slate-700 dark:text-slate-200"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="butt"
      >
        <path d="M0 8 H32" />
        <path d="M14 6 L18 10" />
        <path d="M18 6 L14 10" />
      </g>
    </svg>
  );
}

export default Logo;
