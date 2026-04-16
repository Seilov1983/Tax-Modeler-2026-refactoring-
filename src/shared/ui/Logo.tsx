/**
 * TSM26 "Infinity What-If" Brand Mark.
 *
 * Pure orthogonal infinity (∞) constructed exclusively from horizontal and
 * vertical strokes — no bezier curves, no diagonals. The square-cornered
 * silhouette pays homage to:
 *   - the A* orthogonal flow router that lays every cable on the canvas,
 *   - the Infinite Canvas (pan / zoom without bounds),
 *   - and the mathematical determinism of the tax engine (banker's rounding,
 *     pure functions, hash-chained audit log).
 *
 * Geometry (viewBox 0 0 32 32, centered):
 *   • Primary loop (Apple Blue #007aff) traces the figure-8 silhouette as a
 *     single closed path with a pinched waist in the middle.
 *   • Secondary crosshair (dark slate / dark-mode slate-200) marks the
 *     central intersection where the two lobes meet — the "A* node".
 *
 * The component accepts `className` so callers can size, tint opacity, or
 * animate the mark (e.g. `animate-pulse`, `opacity-5`, `w-6 h-6`).
 */
import * as React from 'react';

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  /** Extra Tailwind / CSS classes — e.g. `w-6 h-6`, `opacity-5 dark:opacity-10`, `animate-pulse`. */
  className?: string;
}

export function Logo({ className, ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {/* Primary orthogonal infinity — Apple Blue */}
      <path
        d="M2 4 H12 V12 H20 V4 H30 V28 H20 V20 H12 V28 H2 Z"
        stroke="#007aff"
        strokeWidth={2.5}
      />
      {/* Secondary crosshair — the central A* intersection */}
      <g
        className="text-slate-700 dark:text-slate-200"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M14 16 H18" />
        <path d="M16 14 V18" />
      </g>
    </svg>
  );
}

export default Logo;
