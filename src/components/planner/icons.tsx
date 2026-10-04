import type { SVGProps } from 'react';

/**
 * Stairs icons drawn in the lucide style (lucide-react has none): 24×24, currentColor stroke,
 * round caps and joins. The path strings are shared with the map markers, which build plain SVG.
 */
export const stairsPaths = {
  /** A flight rising to the left with an arrow pointing up. */
  up: '<path d="M21 7h-4v4h-4v4H9v4H3"/><path d="M6 11V3M3 6l3-3 3 3"/>',
  /** A flight falling to the right with an arrow pointing down. */
  down: '<path d="M3 7h4v4h4v4h4v4h6"/><path d="M18 3v8M15 8l3 3 3-3"/>',
  /** A flight without a known direction. */
  any: '<path d="M21 5h-4v4h-4v4H9v4H5v4H3"/>',
};

/** A lift car with up and down arrows. */
export const elevatorPath = '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 9 3-3 3 3M9 15l3 3 3-3"/>';

type IconProps = SVGProps<SVGSVGElement> & { strokeWidth?: number | string };

function icon(paths: string, name: string) {
  function Icon({ className, strokeWidth = 2, ...props }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={24}
        height={24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={['lucide', className].filter(Boolean).join(' ')}
        dangerouslySetInnerHTML={{ __html: paths }}
        {...props}
      />
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const StairsUp = icon(stairsPaths.up, 'StairsUp');
export const StairsDown = icon(stairsPaths.down, 'StairsDown');
export const Stairs = icon(stairsPaths.any, 'Stairs');
export const Elevator = icon(elevatorPath, 'Elevator');

/** Stairs icon for the direction of travel; mixed or unknown directions get the plain flight. */
export function stairsIcon(direction: 'up' | 'down' | 'unknown') {
  return direction === 'up' ? StairsUp : direction === 'down' ? StairsDown : Stairs;
}
