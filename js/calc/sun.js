// Direct sun on a facade, using SunCalc (global, loaded in index.html).
// A facade receives direct sun when the sun is above the obstruction horizon and
// within 90° of the facade's outward normal.

export const ORIENTATIONS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
export const SEASONS = {
  summer: '2026-06-21',
  equinox: '2026-03-20',
  winter: '2026-12-21',
};
const STEP_MIN = 10;
const AFTERNOON_HOUR = 13; // local time; afternoon sun drives cooling load in Doha

// Heuristic obstruction horizon: dense low floors see the sky only above neighbouring
// buildings. Labelled as a heuristic in the UI.
export function obstructionAltitude(floor, density = 'medium') {
  const base = { low: 8, medium: 20, high: 32 }[density] ?? 20;
  return Math.max(0, base - floor * 1.2);
}

function sunAzimuthFromNorth(pos) {
  // SunCalc azimuth: radians from south, positive towards west.
  return ((pos.azimuth * 180) / Math.PI + 180 + 360) % 360;
}

export function facadeSun({ lat, lng, facadeDeg, floor = 10, density = 'medium', date }) {
  const day = new Date(`${date}T00:00:00+03:00`);
  const minAlt = obstructionAltitude(floor, density);
  let total = 0, afternoon = 0;
  const path = [];
  for (let m = 0; m < 24 * 60; m += STEP_MIN) {
    const t = new Date(day.getTime() + m * 60000);
    const pos = SunCalc.getPosition(t, lat, lng);
    const alt = (pos.altitude * 180) / Math.PI;
    const az = sunAzimuthFromNorth(pos);
    if (alt > 0) path.push({ t: m / 60, alt, az });
    const diff = Math.abs(((az - facadeDeg + 540) % 360) - 180);
    if (alt > minAlt && diff < 90) {
      total += STEP_MIN / 60;
      if (m / 60 >= AFTERNOON_HOUR) afternoon += STEP_MIN / 60;
    }
  }
  return { hours: total, afternoonHours: afternoon, minAlt, path };
}

export function facadeSunAllSeasons(opts) {
  return Object.fromEntries(Object.entries(SEASONS).map(([k, date]) => [k, facadeSun({ ...opts, date })]));
}

// Rough heat-gain rating from summer afternoon exposure.
export function heatRating(summerAfternoonHours) {
  if (summerAfternoonHours >= 4) return 'high';
  if (summerAfternoonHours >= 2) return 'moderate';
  return 'low';
}
