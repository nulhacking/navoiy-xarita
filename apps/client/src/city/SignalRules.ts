import { projectToEdge, type PointXZ, type RoadEdge } from './RoadNetwork.ts';

export type SignalPhase = 'red' | 'amber' | 'green';
/** Fixed simulated timing, not a claim about Navoiy's actual controller schedules. */
export function signalPhase(time: number, edge: RoadEdge): SignalPhase {
  const northSouth = Math.abs(edge.b.z - edge.a.z) >= Math.abs(edge.b.x - edge.a.x);
  const phase = ((time + (northSouth ? 0 : 25)) % 50 + 50) % 50;
  return phase < 20 ? 'green' : phase < 23 ? 'amber' : 'red';
}
export function signalStops(edges: RoadEdge[], points: PointXZ[]): Map<string, number[]> {
  const stops = new Map<string, number[]>();
  const junctions = new Map<string, {neighbors:Set<string>;width:number}>();
  for (const edge of edges) for (const [key,other] of [[edge.from,edge.to],[edge.to,edge.from]]) {
    const entry = junctions.get(key!) ?? {neighbors:new Set<string>(),width:0};
    entry.neighbors.add(other!); entry.width=Math.max(entry.width,edge.width); junctions.set(key!,entry);
  }
  for (const edge of edges) for (const point of points) {
    const p = projectToEdge(edge, point);
    if (Math.hypot(p.x - point.x, p.z - point.z) > 2 || p.distance < 4) continue;
    const junction=junctions.get(edge.to);
    // A signal at the shared centre needs approach setbacks; four zebra crossings
    // drawn at that centre would overlap into a white grid.
    const setback = junction && junction.neighbors.size>=3 && edge.length-p.distance<2 ? junction.width/2+3 : 0;
    const distance = Math.max(0, p.distance - 5 - setback);
    const list = stops.get(edge.key) ?? [];
    if (!list.some(d => Math.abs(d-distance) < 3)) list.push(distance);
    stops.set(edge.key, list.sort((a,b) => a-b));
  }
  return stops;
}
