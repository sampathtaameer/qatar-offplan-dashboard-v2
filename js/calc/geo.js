const R = 6371000; // Earth radius, metres
const rad = (d) => (d * Math.PI) / 180;

export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Local flat projection around a reference point (fine at city scale), metres east/north.
export function toXY(p, ref) {
  return { x: rad(p.lng - ref.lng) * R * Math.cos(rad(ref.lat)), y: rad(p.lat - ref.lat) * R };
}

// Distance from point to a polyline [[lat,lng],...], metres.
export function distanceToPolylineM(p, coords) {
  const ref = p;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = toXY({ lat: coords[i][0], lng: coords[i][1] }, ref);
    const b = toXY({ lat: coords[i + 1][0], lng: coords[i + 1][1] }, ref);
    best = Math.min(best, segDist({ x: 0, y: 0 }, a, b));
  }
  return best;
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function nearest(p, items) {
  let best = null;
  for (const it of items) {
    const d = distanceM(p, it);
    if (!best || d < best.d) best = { item: it, d };
  }
  return best;
}

export function mapsLink(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
export function directionsLink(from, to) {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=walking`;
}
