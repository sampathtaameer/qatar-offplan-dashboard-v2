import { nearest } from './geo.js';

// Each category scores 100 at or below `good` metres and 0 at or beyond `poor` metres.
export const CATEGORIES = {
  metro:    { weight: 30, good: 600,  poor: 4000 },
  school:   { weight: 20, good: 1500, poor: 6000 },
  hospital: { weight: 15, good: 2500, poor: 12000 },
  mall:     { weight: 20, good: 1500, poor: 8000 },
  beach:    { weight: 15, good: 1000, poor: 10000 },
};

export function livability(p, pois = []) {
  const parts = Object.entries(CATEGORIES).map(([type, c]) => {
    const n = nearest(p, pois.filter((x) => x.type === type));
    if (!n) return { type, score: null, nearest: null, distanceM: null, weight: c.weight };
    const s = 100 * Math.max(0, Math.min(1, (c.poor - n.d) / (c.poor - c.good)));
    return { type, score: s, nearest: n.item, distanceM: n.d, weight: c.weight };
  });
  const scored = parts.filter((x) => x.score != null);
  const wsum = scored.reduce((s, x) => s + x.weight, 0);
  const total = wsum ? scored.reduce((s, x) => s + x.score * x.weight, 0) / wsum : null;
  return { total, parts };
}
