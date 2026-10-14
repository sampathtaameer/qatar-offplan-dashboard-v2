// Area comparables: every registered residential-unit sale (MoJ) in the last `months` months.
// Units under 25 sqm are dropped as likely parking/storage registrations.
export const MIN_DEALS = 8;

export function areaPriceStats(deals = [], { months = 12 } = {}) {
  if (!deals.length) return null;
  const latest = deals.reduce((m, d) => (d.date > m ? d.date : m), '');
  const cutoff = new Date(latest);
  cutoff.setMonth(cutoff.getMonth() - months);
  const from = cutoff.toISOString().slice(0, 10);
  const obs = deals.filter((d) => d.date > from && d.sqm >= 25).map((d) => d.ppsqm).sort((a, b) => a - b);
  if (obs.length < MIN_DEALS) return null;
  return {
    n_deals: obs.length,
    p10: quantile(obs, 0.1),
    p25: quantile(obs, 0.25),
    median: quantile(obs, 0.5),
    p75: quantile(obs, 0.75),
    p90: quantile(obs, 0.9),
    min: obs[0],
    max: obs[obs.length - 1],
    from,
    to: latest,
  };
}

export function statsForArea(data, areaId, opts) {
  const { areaId: compsId, deals } = data.compsFor(areaId);
  const stats = areaPriceStats(deals, opts);
  return stats ? { ...stats, compsId, borrowed: compsId !== areaId } : null;
}

// Monthly median price per sqm, for trend charts.
export function monthlyMedians(deals = []) {
  const byMonth = {};
  for (const d of deals) if (d.sqm >= 25) (byMonth[d.date.slice(0, 7)] ||= []).push(d.ppsqm);
  return Object.keys(byMonth).sort().map((m) => {
    const v = byMonth[m].sort((a, b) => a - b);
    return { month: m, median: quantile(v, 0.5), n: v.length };
  });
}

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Neutral positioning: where a price sits relative to the area's interquartile range.
export function pricePosition(pricePerSqm, stats) {
  if (!pricePerSqm || !stats) return null;
  const band = pricePerSqm < stats.p25 ? 'below' : pricePerSqm > stats.p75 ? 'above' : 'within';
  const vsMedian = pricePerSqm / stats.median - 1;
  return { band, vsMedian };
}

// Apartment-type units only: comparables are registered apartment sales, and MoJ villa
// records give plot area, so a villa's price per sqm is not comparable.
// Not comparable with MoJ apartment sales: villas (plot area) and commercial units.
export const NOT_APARTMENT = new Set(['villa', 'townhouse', 'office', 'shop', 'warehouse', 'building', 'hotel_apartment']);

export function projectPricePerSqm(project) {
  if (project.price_per_sqm_qar) return project.price_per_sqm_qar;
  const vals = (project.unit_mix || [])
    .filter((u) => u.price_from_qar && u.size_sqm_min && !NOT_APARTMENT.has(u.type))
    .map((u) => u.price_from_qar / u.size_sqm_min);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function grossYield(priceQar, monthlyRentQar) {
  if (!priceQar || !monthlyRentQar) return null;
  return (monthlyRentQar * 12) / priceQar;
}

// Yield per unit type, matching the project's unit mix to area asking rents.
export function unitYields(project, areaRents = []) {
  return (project.unit_mix || []).map((u) => {
    const rent = areaRents.find((r) => r.unit_type === u.type);
    return {
      type: u.type,
      price: u.price_from_qar ?? null,
      rent: rent?.median_qar_month ?? null,
      rentSource: rent ?? null,
      yield: grossYield(u.price_from_qar, rent?.median_qar_month),
    };
  });
}

// ---------- v2: like-for-like comparables by unit size ----------
// MoJ unit sales carry no bedroom count, so "like for like" means similar floor area.
export const SIZE_BANDS = [[25, 75], [75, 110], [110, 160], [160, 250], [250, Infinity]];
export function bandOf(sqm) {
  if (!sqm) return null;
  const i = SIZE_BANDS.findIndex(([lo, hi]) => sqm >= lo && sqm < hi);
  return i < 0 ? null : i;
}
export function bandName(i) {
  const [lo, hi] = SIZE_BANDS[i];
  return hi === Infinity ? `${lo}+ sqm` : `${lo}–${hi} sqm`;
}

const bandCache = new Map();
// Registered unit sales in the comps area, last 12 months, within one size band.
export function bandStats(data, areaId, band, { months = 12 } = {}) {
  const key = `${areaId}|${band}|${months}`;
  if (bandCache.has(key)) return bandCache.get(key);
  const { areaId: compsId, deals } = data.compsFor(areaId);
  let out = null;
  if (deals.length) {
    const latest = deals.reduce((m, d) => (d.date > m ? d.date : m), '');
    const cutoff = new Date(latest);
    cutoff.setMonth(cutoff.getMonth() - months);
    const from = cutoff.toISOString().slice(0, 10);
    const [lo, hi] = SIZE_BANDS[band];
    const obs = deals.filter((d) => d.date > from && d.sqm >= lo && d.sqm < hi).map((d) => d.ppsqm).sort((a, b) => a - b);
    if (obs.length >= MIN_DEALS) {
      out = { n_deals: obs.length, p25: quantile(obs, 0.25), median: quantile(obs, 0.5), p75: quantile(obs, 0.75), from, to: latest, compsId, band, borrowed: compsId !== areaId };
    }
  }
  bandCache.set(key, out);
  return out;
}

// Per-unit comparison: each apartment-type unit's QAR/sqm vs registered deals of similar size.
// Falls back to the whole-area distribution (flagged) when the band has too few deals.
export function unitComps(data, project) {
  const area = statsForArea(data, project.area_id);
  return (project.unit_mix || []).map((u) => {
    const ok = u.price_from_qar && u.size_sqm_min && !NOT_APARTMENT.has(u.type);
    if (!ok) return { unit: u, ppsqm: null };
    const ppsqm = u.price_from_qar / u.size_sqm_min;
    const band = bandOf(u.size_sqm_min);
    let stats = band == null ? null : bandStats(data, project.area_id, band);
    let fallback = false;
    if (!stats && area) { stats = area; fallback = true; }
    if (!stats) return { unit: u, ppsqm, band };
    const pos = pricePosition(ppsqm, stats);
    return { unit: u, ppsqm, band, stats, fallback, premium: pos.vsMedian, position: pos.band };
  });
}

// Project premium vs like-for-like registered deals = median of its units' premiums.
export function projectPremium(data, project) {
  const units = unitComps(data, project).filter((x) => x.premium != null);
  if (!units.length) return null;
  const v = units.map((x) => x.premium).sort((a, b) => a - b);
  return { premium: quantile(v, 0.5), n: units.length, fallback: units.every((x) => x.fallback), units };
}

// Net yield: rent after vacancy and service charge, over price plus purchase costs.
export function netYield(price, rentMonthly, sizeSqm, a) {
  if (!price || !rentMonthly || !a) return null;
  const sc = sizeSqm ? a.service_charge_qar_sqm_month * sizeSqm * 12 : 0;
  return (rentMonthly * 12 * (1 - a.vacancy) - sc) / (price * (1 + a.purchase_fees));
}

export function unitYieldsNet(project, areaRents = [], a) {
  return unitYields(project, areaRents).map((y, i) => {
    const u = project.unit_mix[i];
    const size = u.size_sqm_min || y.rentSource?.typical_size_sqm || null;
    return { ...y, size, net: netYield(y.price, y.rent, size, a), sample: y.rentSource?.sample ?? null, smallSample: (y.rentSource?.sample ?? 0) < 15 };
  });
}

export function fromPrice(project) {
  const v = (project.unit_mix || []).map((u) => u.price_from_qar).filter(Boolean);
  return v.length ? Math.min(...v) : null;
}
