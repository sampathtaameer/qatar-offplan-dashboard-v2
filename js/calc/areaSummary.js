// One summary row per area: registered sales, prices, off-plan activity, rents and yield, location.
import { statsForArea, areaPriceStats, quantile, projectPricePerSqm, projectPremium } from './pricing.js';
import { livability } from './livability.js';
import { noiseProfile } from './noise.js';

const median = (v) => (v.length ? quantile(v.slice().sort((a, b) => a - b), 0.5) : null);

// Count-weighted median of weekly medians (transactions.json keeps one median per week and category).
function weightedMedian(pairs) {
  const p = pairs.filter(([v, c]) => v && c).sort((a, b) => a[0] - b[0]);
  const tot = p.reduce((s, [, c]) => s + c, 0);
  let acc = 0;
  for (const [v, c] of p) { acc += c; if (acc >= tot / 2) return v; }
  return null;
}

export function windowWeeks(data, n = 52) {
  const weeks = [...new Set(data.transactions.map((r) => r.week))].sort();
  const last = weeks[weeks.length - 1];
  const back = (days) => { const d = new Date(`${last}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
  // Sales trend: last 26 weeks vs the same 26 weeks a year earlier (the history is too short for two full years).
  const h1 = back(182), y0 = back(364), y1 = back(364 + 182);
  return {
    recent: new Set(weeks.slice(-n)), first: weeks[Math.max(0, weeks.length - n)], last,
    half: new Set(weeks.filter((w) => w > h1)), halfPrior: new Set(weeks.filter((w) => w > y1 && w <= y0)),
    hasPrior: weeks[0] <= y1,
  };
}

// Apartment median: last 6 months vs the same 6 months a year earlier, own deals only.
function apartmentYoY(deals) {
  if (!deals.length) return null;
  const latest = deals.reduce((m, d) => (d.date > m ? d.date : m), '');
  const shift = (iso, months) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10); };
  const pick = (to, from) => deals.filter((d) => d.sqm >= 25 && d.date > from && d.date <= to).map((d) => d.ppsqm);
  const now = pick(latest, shift(latest, 6));
  const before = pick(shift(latest, 12), shift(latest, 18));
  if (now.length < 8 || before.length < 8) return null;
  return median(now) / median(before) - 1;
}

export function areaSummary(data, a, win, assumptions) {
  const tx = data.txByArea[a.id] || [];
  const recent = tx.filter((r) => win.recent.has(r.week));
  const half = tx.filter((r) => win.half.has(r.week));
  const halfPrior = tx.filter((r) => win.halfPrior.has(r.week));
  const sum = (rows, f = () => true, k = 'count') => rows.filter(f).reduce((s, r) => s + (r[k] || 0), 0);
  const isT = (t) => (r) => r.property_type === t;
  const own = data.dealsByArea[a.id] || [];
  const ownStats = areaPriceStats(own);
  const stats = statsForArea(data, a.id); // may borrow comparables (Qetaifan, Gewan)

  const deals = sum(recent);
  const h = sum(half), hp = sum(halfPrior);
  const villaRows = recent.filter(isT('villa'));
  const landRows = recent.filter(isT('land'));
  const villas = sum(villaRows);

  // Off-plan projects in this area.
  const projects = (data.projectsByArea[a.id] || []).filter((p) => p.status !== 'completed');
  const ppsqm = projects.map((p) => projectPricePerSqm(p)).filter(Boolean);
  const prem = projects.map((p) => projectPremium(data, p)?.premium).filter((x) => x != null);
  const thisYear = Number((win.last || '').slice(0, 4)) || new Date().getFullYear();
  const pipe = (data.pipelineByArea[a.id] || []).filter((r) => r.year >= thisYear && r.year <= thisYear + 3).reduce((s, r) => s + r.units, 0);
  const listings = projects.reduce((s, p) => s + (p.broker_listings?.listings || 0), 0);

  // Rents and gross yield (2-bed apartment at the area's median price per sqm, else 1-bed).
  const rents = data.rentsFor(a.id); // borrows the comparables area's rents when there are none (Qetaifan from Lusail)
  const rent = (u) => rents.find((r) => r.unit_type === u) || null;
  const r1 = rent('1br'), r2 = rent('2br'), rv = rent('villa');
  const yieldOf = (r) => (r && stats && r.typical_size_sqm ? (r.median_qar_month * 12) / (stats.median * r.typical_size_sqm) : null);
  const villaAvgPrice = villas >= 5 ? sum(villaRows, undefined, 'value_qar') / villas : null;
  const aptYield = yieldOf(r2) ?? yieldOf(r1);
  // Where no apartments trade, the yield is a villa yield: median villa rent against the average registered villa price.
  const villaYield = rv && villaAvgPrice ? (rv.median_qar_month * 12) / villaAvgPrice : null;
  const gy = aptYield ?? villaYield;
  const ny = aptYield == null ? null : (() => {
    const r = r2 && r2.typical_size_sqm ? r2 : r1;
    if (!r || !stats || !r.typical_size_sqm || !assumptions) return null;
    const price = stats.median * r.typical_size_sqm;
    const sc = assumptions.service_charge_qar_sqm_month * r.typical_size_sqm * 12;
    return (r.median_qar_month * 12 * (1 - assumptions.vacancy) - sc) / (price * (1 + assumptions.purchase_fees));
  })();

  return {
    a,
    deals, dealsChange: win.hasPrior && hp >= 10 ? h / hp - 1 : null,
    value: sum(recent, undefined, 'value_qar'),
    units: sum(recent, isT('unit')),
    villas,
    land: sum(landRows),
    other: sum(recent, (r) => !['unit', 'villa', 'land'].includes(r.property_type)),
    aptMedian: ownStats?.median ?? null,
    aptN: ownStats?.n_deals ?? 0,
    aptP25: ownStats?.p25 ?? null,
    aptP75: ownStats?.p75 ?? null,
    aptYoY: apartmentYoY(own),
    compsMedian: stats?.median ?? null,
    compsBorrowed: !!stats?.borrowed,
    villaAvg: villas ? sum(villaRows, undefined, 'value_qar') / villas : null,
    villaSqm: weightedMedian(villaRows.map((r) => [r.ppsqm_median_qar, r.count])),
    landSqm: weightedMedian(landRows.map((r) => [r.ppsqm_median_qar, r.count])),
    projects: projects.length,
    devProjects: projects.filter((p) => p.source_kind !== 'broker').length,
    listings,
    offplanSqm: median(ppsqm),
    premium: median(prem),
    pipeline: pipe,
    rent1: r1?.median_qar_month ?? null,
    rent2: r2?.median_qar_month ?? null,
    rentVilla: rv?.median_qar_month ?? null,
    rentN: (data.rentsByArea[a.id] || []).reduce((s, r) => s + (r.listings_total ?? r.sample ?? 0), 0),
    rentsBorrowed: !(data.rentsByArea[a.id] || []).length && rents.length > 0,
    grossYield: gy,
    yieldBasis: aptYield != null ? 'apt' : villaYield != null ? 'villa' : null,
    netYield: ny,
    liv: livability(a, data.poi).total,
    air: noiseProfile(a, data.noise).airLevel,
  };
}
