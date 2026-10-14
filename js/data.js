// Loads every data file once and builds lookup indexes.
import { parseCSV, numOrNull } from './csv.js';

const FILES = ['areas', 'projects', 'transactions', 'deals', 'rents', 'pipeline', 'poi', 'noise', 'rules', 'changes',
  'project_history', 'assumptions', 'watchlist', 'review'];
const CSVS = ['taameer_projects', 'developers', 'project_overrides'];
const STALE_DAYS = { transactions: 21, deals: 21, rents: 120, projects: 21, pipeline: 180, areas: 365, poi: 365, noise: 365, rules: 180, project_history: 21 };
export const TAAMEER_DEV = 'TAAMEER Development';

let cache = null;

export async function loadData() {
  if (cache) return cache;
  const get = async (path, kind) => {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return kind === 'csv' ? parseCSV(await res.text()) : res.json();
  };
  const [jsons, csvs] = await Promise.all([
    Promise.all(FILES.map(async (n) => [n, await get(`data/${n}.json`)])),
    Promise.all(CSVS.map(async (n) => [n, await get(`data/${n}.csv`, 'csv')])),
  ]);
  cache = index(Object.fromEntries(jsons), Object.fromEntries(csvs));
  return cache;
}

function index(raw, csv) {
  const areas = raw.areas.records;
  const projects = raw.projects.records;
  for (const p of projects) p.taameer = p.developer === TAAMEER_DEV;
  const byId = (list) => Object.fromEntries(list.map((r) => [r.id, r]));
  const groupBy = (list, key) => list.reduce((acc, r) => ((acc[r[key]] ||= []).push(r), acc), {});

  // deals.json rows are [date, area_id, sqm, value]; expand once.
  const deals = raw.deals.records.map(([date, area_id, sqm, value]) => ({ date, area_id, sqm, value, ppsqm: value / sqm }));
  const dealsByArea = groupBy(deals, 'area_id');
  const areaById = byId(areas);
  // Areas without their own registered deals (e.g. Qetaifan, Gewan) borrow comparables.
  const compsFor = (areaId) => {
    const a = areaById[areaId];
    const own = dealsByArea[areaId] || [];
    if (own.length >= 20 || !a?.comps_area) return { areaId, deals: own };
    return { areaId: a.comps_area, deals: dealsByArea[a.comps_area] || [] };
  };

  const rentsByArea = groupBy(raw.rents.records, 'area_id');
  const rentsFor = (areaId) => rentsByArea[areaId] || rentsByArea[areaById[areaId]?.comps_area] || [];

  // Supply pipeline: external records (pipeline.json) plus tracked projects' units by handover year.
  const pipeline = [...raw.pipeline.records];
  for (const p of projects) {
    const year = Number(String(p.handover || '').slice(0, 4));
    if (!year || !p.units_total || p.status === 'completed') continue;
    const hit = pipeline.find((r) => r.area_id === p.area_id && r.year === year && r.derived);
    if (hit) hit.units += p.units_total;
    else pipeline.push({ area_id: p.area_id, year, units: p.units_total, derived: true, source: 'Tracked projects (projects.json + override sheet)', as_of: raw.projects.as_of, confidence: 'medium' });
  }

  // Taameer's own projects from the internal template (one row per unit type).
  const tmRows = csv.taameer_projects.filter((r) => r.project && r.name_en);
  const tmGroups = groupBy(tmRows, 'project');
  const projectById = byId(projects);
  const taameerProjects = Object.entries(tmGroups).map(([pid, rows]) => {
    const r0 = rows[0];
    const listing = projectById[pid];
    const plan = ['down_pct', 'during_pct', 'handover_pct', 'after_pct'].some((k) => r0[k] !== '') ? [{
      label: 'Internal', down: (numOrNull(r0.down_pct) || 0) / 100, during: (numOrNull(r0.during_pct) || 0) / 100,
      handover: (numOrNull(r0.handover_pct) || 0) / 100, after: (numOrNull(r0.after_pct) || 0) / 100,
      years_during: numOrNull(r0.years_during), years_after: numOrNull(r0.years_after), remainder_assumed: false,
    }] : (listing?.payment_plans || []);
    return {
      id: pid, internal: true, taameer: true, listing_id: listing ? pid : null,
      name_en: r0.name_en, name_ar: r0.name_ar || listing?.name_ar, developer: TAAMEER_DEV,
      area_id: r0.area_id || listing?.area_id, lat: numOrNull(r0.lat) ?? listing?.lat, lng: numOrNull(r0.lng) ?? listing?.lng,
      status: r0.status || listing?.status || 'off_plan', handover: r0.handover || listing?.handover || null,
      units_total: numOrNull(r0.units_total) ?? listing?.units_total ?? null, floors: numOrNull(r0.floors) ?? listing?.floors ?? null,
      unit_mix: rows.map((r) => ({ type: r.unit_type, size_sqm_min: numOrNull(r.size_sqm), size_sqm_max: numOrNull(r.size_sqm), price_from_qar: numOrNull(r.price_qar) })),
      payment_plans: plan, source: r0.source, as_of: r0.as_of,
      fromListing: /property finder/i.test(r0.source || ''),
    };
  });

  const devNotes = Object.fromEntries(csv.developers.filter((r) => r.developer).map((r) => [r.developer.replace(/[  ]/g, ' ').trim(), r]));

  return {
    raw,
    meta: Object.fromEntries(FILES.filter((f) => raw[f].as_of).map((f) => [f, { as_of: raw[f].as_of, stale: isStale(raw[f].as_of, STALE_DAYS[f]) }])),
    areas,
    areaById,
    deals,
    dealsByArea,
    compsFor,
    projects,
    projectById,
    projectsByArea: groupBy(projects, 'area_id'),
    transactions: raw.transactions.records,
    txByArea: groupBy(raw.transactions.records, 'area_id'),
    rents: raw.rents.records,
    rentsByArea,
    rentsFor,
    pipeline,
    pipelineByArea: groupBy(pipeline, 'area_id'),
    poi: raw.poi.records,
    noise: raw.noise,
    rules: raw.rules,
    changes: raw.changes.records,
    history: raw.project_history,
    defaults: raw.assumptions,
    watchShared: raw.watchlist.ids || [],
    taameerProjects,
    devNotes,
    overrides: csv.project_overrides,
    review: raw.review.records || [],
  };
}

export function isStale(asOf, days) {
  if (!asOf || !days) return false;
  return (Date.now() - new Date(asOf).getTime()) / 86400000 > days;
}

export const SQFT_PER_SQM = 10.7639;
