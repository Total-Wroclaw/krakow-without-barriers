import type { JourneyOption } from './journey-types';
import type { Report } from './schemas';

/** Local equirectangular projection is sufficient for the 40 m report corridor in Kraków. */
export function nearRoute(report: Pick<Report, 'location'>, option: Pick<JourneyOption, 'legs'> | undefined, radius = 40) {
  if (!option || !report.location) return false;
  const { lat, lon } = report.location;
  const k = Math.cos((lat * Math.PI) / 180);
  const project = ([a, b]: [number, number]) => [(b - lon) * 111_000 * k, (a - lat) * 111_000] as const;
  return option.legs.some(leg => {
    if (leg.type !== 'walk') return false;
    return leg.geometry.some((point, i) => {
      const [ax, ay] = project(point);
      if (!i) return Math.hypot(ax, ay) <= radius;
      const [bx, by] = project(leg.geometry[i - 1]);
      const dx = bx - ax, dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      // Repeated vertices are points, never a division by zero.
      const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
      return Math.hypot(ax + t * dx, ay + t * dy) <= radius;
    });
  });
}
