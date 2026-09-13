import type { CityMapData } from './CityTile.ts';

export interface PointXZ { x: number; z: number }
export interface RoadEdge {
  key: string;
  from: string;
  to: string;
  a: PointXZ;
  b: PointXZ;
  length: number;
  width: number;
  name: string;
  footway: boolean;
}

const DRIVABLE = new Set(['primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'service']);
const WALKABLE = new Set(['footway', 'pedestrian', 'path']);
const nodeKey = (p: PointXZ) => `${Math.round(p.x)},${Math.round(p.z)}`;

/** Only shared OSM vertices form junctions; crossing lines are not automatically connected. */
export class RoadNetwork {
  readonly edges: RoadEdge[] = [];
  private readonly outgoing = new Map<string, RoadEdge[]>();

  constructor(maps: Iterable<CityMapData>, pedestrian = false) {
    const seen = new Set<string>();
    for (const map of maps) for (const road of map.roads) {
      const footway = WALKABLE.has(road.cls);
      if (road.elevated || !(DRIVABLE.has(road.cls) || (pedestrian && footway))) continue;
      for (let i = 0; i + 3 < road.pts.length; i += 2) {
        const a = { x: road.pts[i]!, z: road.pts[i + 1]! };
        const b = { x: road.pts[i + 2]!, z: road.pts[i + 3]! };
        const length = Math.hypot(a.x - b.x, a.z - b.z);
        if (length < 1) continue;
        for (const reverse of [false, true]) {
          if (!pedestrian && ((road.oneway === 1 && reverse) || (road.oneway === -1 && !reverse))) continue;
          const start = reverse ? b : a;
          const end = reverse ? a : b;
          const from = nodeKey(start), to = nodeKey(end);
          const key = `${from}>${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const edge: RoadEdge = { key, from, to, a: start, b: end, length, width: road.width, name: road.name ?? '', footway };
          this.edges.push(edge);
          const list = this.outgoing.get(from) ?? [];
          list.push(edge);
          this.outgoing.set(from, list);
        }
      }
    }
  }

  next(edge: RoadEdge, choice: number): RoadEdge | null {
    const exits = this.outgoing.get(edge.to) ?? [];
    const forward = exits.filter((candidate) => candidate.to !== edge.from);
    const candidates = forward.length ? forward : exits;
    return candidates.length ? candidates[Math.floor(choice * candidates.length) % candidates.length]! : null;
  }

  nearby(point: PointXZ, radius: number): RoadEdge[] {
    return this.edges.filter((edge) => {
      const nearest = projectToEdge(edge, point);
      return Math.hypot(nearest.x - point.x, nearest.z - point.z) < radius;
    });
  }
}

export function projectToEdge(edge: RoadEdge, point: PointXZ): PointXZ & { distance: number } {
  const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z;
  const t = Math.max(0, Math.min(1, ((point.x - edge.a.x) * dx + (point.z - edge.a.z) * dz) / edge.length ** 2));
  return { x: edge.a.x + dx * t, z: edge.a.z + dz * t, distance: t * edge.length };
}

/** X east, Z south: right-hand lane is (-dz, dx). */
export function lanePoint(edge: RoadEdge, distance: number, pedestrian: boolean): PointXZ {
  const dx = (edge.b.x - edge.a.x) / edge.length;
  const dz = (edge.b.z - edge.a.z) / edge.length;
  const offset = pedestrian ? (edge.footway ? Math.min(0.5, edge.width * 0.2) : edge.width / 2 + 1.1) : Math.min(2.8, edge.width / 4);
  return { x: edge.a.x + dx * distance - dz * offset, z: edge.a.z + dz * distance + dx * offset };
}

export function insidePolygon(point: PointXZ, ring: Float32Array): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!, zi = ring[i + 1]!, xj = ring[j]!, zj = ring[j + 1]!;
    if ((zi > point.z) !== (zj > point.z) && point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
