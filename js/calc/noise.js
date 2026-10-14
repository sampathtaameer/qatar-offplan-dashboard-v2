import { toXY, distanceToPolylineM } from './geo.js';

// Distance-based noise model (not measured decibels):
//  - Aircraft: each runway's extended centreline forms an approach/departure corridor.
//    Exposure falls with lateral offset from the centreline and with distance past the threshold.
//  - Roads: distance to major highways.
const CORRIDOR_LENGTH_M = 16000;
const CORRIDOR_HALF_WIDTH_M = 2000;

export function aircraftExposure(p, runways = []) {
  let best = { score: 0, runway: null, alongM: null, lateralM: null };
  for (const rw of runways) {
    const a = toXY({ lat: rw.end1[0], lng: rw.end1[1] }, p);
    const b = toXY({ lat: rw.end2[0], lng: rw.end2[1] }, p);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    // Point is at origin; project onto the runway axis.
    const t = (0 - a.x) * ux + (0 - a.y) * uy; // metres from end1 along axis
    const lateral = Math.abs((0 - a.x) * uy - (0 - a.y) * ux);
    let beyond; // metres past the nearest threshold (0 if alongside runway)
    if (t < 0) beyond = -t; else if (t > len) beyond = t - len; else beyond = 0;
    if (beyond > CORRIDOR_LENGTH_M) continue;
    // Corridor widens slightly with distance.
    const halfWidth = CORRIDOR_HALF_WIDTH_M + beyond * 0.05;
    if (lateral > halfWidth * 1.5) continue;
    const lateralF = Math.max(0, 1 - lateral / (halfWidth * 1.5));
    const alongF = Math.max(0, 1 - beyond / CORRIDOR_LENGTH_M);
    const score = lateralF * alongF * (rw.weight ?? 1);
    if (score > best.score) best = { score, runway: rw.name, alongM: beyond, lateralM: lateral };
  }
  return best;
}

export function roadExposure(p, roads = []) {
  let best = { score: 0, road: null, distanceM: null };
  for (const r of roads) {
    const d = distanceToPolylineM(p, r.coords);
    const score = Math.max(0, 1 - d / 600);
    if (best.distanceM == null || d < best.distanceM) best = { score, road: r.name, distanceM: d };
  }
  return best;
}

export function noiseLevel(score) {
  if (score >= 0.6) return 'high';
  if (score >= 0.3) return 'moderate';
  if (score > 0.05) return 'low';
  return 'minimal';
}

export function noiseProfile(p, noiseData) {
  const air = aircraftExposure(p, noiseData?.runways);
  const road = roadExposure(p, noiseData?.roads);
  return { air, road, airLevel: noiseLevel(air.score), roadLevel: noiseLevel(road.score) };
}
