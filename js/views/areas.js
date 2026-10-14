import { t, L, nf, qar, qarShort, pct, dateFmt, stored, store } from '../i18n.js';
import { chart, esc, regimeBadge, sourceNote, calcPanel, tableView, confBadge, css, exportBtn, handoverCell, deltaSpan, premSpan, makeMap, Leaflet } from '../ui.js';
import { areaSummary, windowWeeks } from '../calc/areaSummary.js';
import { getAssumptions, assumptionsLine } from '../settings.js';
import { exportSheets, round } from '../export.js';
import { statsForArea, grossYield, monthlyMedians } from '../calc/pricing.js';
import { livabilityCard, noiseCard, locationMap, mapLegend } from './shared.js';

// Property categories in a fixed order so colours follow the category, never its rank.
export const CATS = ['unit', 'villa', 'land', 'other'];
const catOf = (t) => (CATS.includes(t) ? t : 'other');

export function lastWeeks(data, n = 52) {
  return new Set([...new Set(data.transactions.map((r) => r.week))].sort().slice(-n));
}

const VIEWS = {
  summary: ['deals', 'dealsChange', 'value', 'aptMedian', 'projects', 'grossYield', 'liv'],
  sales: ['deals', 'value', 'units', 'villas', 'land', 'other', 'aptMedian', 'aptYoY', 'villaAvg', 'villaSqm', 'landSqm'],
  offplan: ['projects', 'listings', 'offplanSqm', 'compsMedian', 'premium', 'pipeline'],
  rent: ['rent1', 'rent2', 'rentVilla', 'rentN', 'grossYield', 'netYield'],
  location: ['liv', 'air', 'conf'],
};
const COLS = {
  deals: ['as.deals', 'n'], dealsChange: ['as.dealsChange', 'chg'], value: ['as.value', 'qs'], units: ['as.units', 'n'], villas: ['as.villas', 'n'],
  land: ['as.land', 'n'], other: ['as.other', 'n'], aptMedian: ['as.aptMedian', 'apt'], aptYoY: ['as.aptYoY', 'chg'], villaAvg: ['as.villaAvg', 'qs'],
  villaSqm: ['as.villaSqm', 'n'], landSqm: ['as.landSqm', 'n'], projects: ['as.projects', 'proj'], listings: ['as.listings', 'n'],
  offplanSqm: ['as.offplanSqm', 'n'], compsMedian: ['as.compsMedian', 'comps'], premium: ['as.premium', 'prem'], pipeline: ['as.pipeline', 'n'],
  rent1: ['as.rent1', 'n'], rent2: ['as.rent2', 'n'], rentVilla: ['as.rentVilla', 'n'], rentN: ['as.rentN', 'n'], grossYield: ['as.grossYield', 'pct'],
  netYield: ['as.netYield', 'pct'], liv: ['as.liv', 'n'], air: ['noise.air', 'air'], conf: ['as.conf', 'conf'],
};
const SUMMABLE = new Set(['deals', 'value', 'units', 'villas', 'land', 'other', 'projects', 'listings', 'pipeline', 'rentN']);

function cell(r, k) {
  const v = r[k];
  const dash = '<span class="muted">—</span>';
  switch (COLS[k][1]) {
    case 'n': return v == null ? dash : `${nf(v)}${r.rentsBorrowed && ['rent1', 'rent2', 'rentVilla'].includes(k) ? '*' : ''}`;
    case 'qs': return v ? qarShort(v) : dash;
    case 'chg': return v == null ? dash : deltaSpan(v);
    case 'pct': return v == null ? dash : `${pct(v)}${k === 'grossYield' && r.yieldBasis === 'villa' ? `<div class="mini">${t('as.villaBasis')}</div>` : ''}`;
    case 'prem': return premSpan(v);
    case 'apt': return v == null ? dash : `${nf(v)}<div class="mini">${t('as.iqrN', { lo: nf(r.aptP25), hi: nf(r.aptP75), n: nf(r.aptN) })}</div>`;
    case 'comps': return v == null ? dash : `${nf(v)}${r.compsBorrowed ? '*' : ''}`;
    case 'proj': return v ? `${nf(v)}<div class="mini">${r.devProjects && v - r.devProjects ? t('as.projSplit', { d: r.devProjects, b: v - r.devProjects }) : r.devProjects ? t('as.projDev') : t('as.projBroker')}</div>` : dash;
    case 'air': return t(`noise.${v}`);
    case 'conf': return confBadge(r.a.confidence);
    default: return esc(v);
  }
}

export function renderAreas(el, data) {
  const win = windowWeeks(data);
  const a = getAssumptions();
  const rows = data.areas.map((x) => areaSummary(data, x, win, a));
  const tot = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const withSales = rows.filter((r) => r.deals > 0).length;
  const withProjects = rows.filter((r) => r.projects > 0).length;
  const withRents = rows.filter((r) => !r.rentsBorrowed && (r.rent1 || r.rent2 || r.rentVilla)).length;
  let view = stored('areasView', 'summary');
  if (!VIEWS[view]) view = 'summary';
  let sortKey = 'deals', sortDir = -1;
  const munis = [...new Set(data.areas.map((x) => x.municipality))].sort();

  el.innerHTML = `
    <div class="page-head"><div><h1>${t('areas.title')}</h1><p class="muted">${t('as.lede', { n: data.areas.length, from: dateFmt(win.first), to: dateFmt(win.last) })}</p></div><div class="page-actions">${exportBtn()}</div></div>
    <div class="grid g-kpi">
      ${kpi(t('as.kAreas'), nf(data.areas.length), t('as.kAreasSub', { f: rows.filter((r) => r.a.regime === 'freehold').length, u: rows.filter((r) => r.a.regime === 'usufruct').length, s: withSales }))}
      ${kpi(t('as.kDeals'), nf(tot('deals')), t('as.kDealsSub', { v: qarShort(tot('value')) }))}
      ${kpi(t('as.kUnits'), nf(tot('units')), t('as.kUnitsSub', { v: nf(tot('villas')), l: nf(tot('land')) }))}
      ${kpi(t('as.kProjects'), nf(tot('projects')), t('as.kProjectsSub', { n: withProjects, l: nf(tot('listings')) }))}
      ${kpi(t('as.kRents'), nf(withRents), t('as.kRentsSub', { n: nf(tot('rentN')) }))}
    </div>
    <div class="card section"><div class="card-head"><h2>${t('as.mapTitle')}</h2>
      <div class="seg" id="mapBy">${['deals', 'aptMedian', 'projects', 'grossYield'].map((k) => `<button type="button" data-m="${k}" class="${k === 'deals' ? 'on' : ''}">${t(COLS[k][0])}</button>`).join('')}</div></div>
      <div id="amap" class="map" style="height:460px"></div><p class="small muted" id="mapNote"></p></div>
    <div class="filters section">
      <label class="field">${t('filter.search')}<input id="q" type="search"></label>
      <label class="field">${t('filter.regime')}<select id="regime"><option value="">${t('filter.all')}</option>
        ${['freehold', 'usufruct', 'qatari_only'].map((r) => `<option value="${r}">${t(`regime.${r}`)}</option>`).join('')}</select></label>
      <label class="field">${t('filter.municipality')}<select id="muni"><option value="">${t('filter.all')}</option>
        ${munis.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
      <label class="switch"><input id="offOnly" type="checkbox"> ${t('as.offOnly')}</label>
    </div>
    <div class="seg" id="views" style="margin-bottom:12px">${Object.keys(VIEWS).map((v) => `<button type="button" data-v="${v}" class="${v === view ? 'on' : ''}">${t(`as.v.${v}`)}</button>`).join('')}</div>
    <div class="card table-wrap areas-table"><table><thead id="th"></thead><tbody id="tb"></tbody><tfoot id="tf"></tfoot></table></div>
    <p class="small muted">${t('as.notes')}</p>
    ${calcPanel(t('calc.how'), `<p>${t('as.calc')}</p><p>${esc(assumptionsLine())}</p>`)}`;

  const th = el.querySelector('#th'), tb = el.querySelector('#tb'), tf = el.querySelector('#tf');
  const val = (r, k) => (k === 'name' ? L(r.a) : k === 'regime' ? r.a.regime : k === 'air' ? ['minimal', 'low', 'moderate', 'high'].indexOf(r.air) : k === 'conf' ? r.a.confidence : r[k] ?? -Infinity);
  let current = [];
  const draw = () => {
    const v = (id) => el.querySelector(id).value;
    const q = v('#q').trim().toLowerCase();
    const off = el.querySelector('#offOnly').checked;
    current = rows.filter(({ a: x, projects }) => (!v('#regime') || x.regime === v('#regime')) && (!v('#muni') || x.municipality === v('#muni')) &&
      (!off || projects > 0) && (!q || `${x.name_en} ${x.name_ar} ${x.municipality}`.toLowerCase().includes(q)));
    current.sort((x, y) => { const p = val(x, sortKey), r = val(y, sortKey); return (typeof p === 'string' ? p.localeCompare(r) : p - r) * sortDir; });
    const cols = VIEWS[view];
    const head = (k, lbl, cls = 'num') => `<th class="${cls}" data-sort="${k}" style="cursor:pointer">${lbl} <span class="mini">${sortKey === k ? (sortDir > 0 ? '▲' : '▼') : ''}</span></th>`;
    th.innerHTML = `<tr>${head('name', t('col.area'), '')}${head('regime', t('col.regime'), '')}${cols.map((k) => head(k, t(COLS[k][0]), k === 'air' || k === 'conf' ? '' : 'num')).join('')}</tr>`;
    tb.innerHTML = current.map((r) => `<tr class="clickable" data-id="${r.a.id}">
      <td><a href="#/area/${r.a.id}">${esc(L(r.a))}</a><div class="small muted">${esc(r.a.municipality)}</div></td><td>${regimeBadge(r.a.regime)}</td>
      ${cols.map((k) => `<td class="${k === 'air' || k === 'conf' ? '' : 'num'}">${cell(r, k)}</td>`).join('')}</tr>`).join('') ||
      `<tr><td colspan="${cols.length + 2}" class="empty">${t('empty.filter')}</td></tr>`;
    tf.innerHTML = current.length > 1 ? `<tr><th>${t('as.total', { n: current.length })}</th><th></th>${cols.map((k) => `<th class="num">${SUMMABLE.has(k) ? (COLS[k][1] === 'qs' ? qarShort(current.reduce((s, r) => s + (r[k] || 0), 0)) : nf(current.reduce((s, r) => s + (r[k] || 0), 0))) : ''}</th>`).join('')}</tr>` : '';
    th.querySelectorAll('th[data-sort]').forEach((h) => h.addEventListener('click', () => {
      const k = h.dataset.sort; sortDir = sortKey === k ? -sortDir : (k === 'name' || k === 'regime' ? 1 : -1); sortKey = k; draw();
    }));
    drawMap();
  };

  // Map: one circle per area, sized or coloured by the chosen measure.
  const map = makeMap(el.querySelector('#amap'), [25.33, 51.42], 9);
  let layer = Leaflet.layerGroup().addTo(map);
  let mapBy = 'deals';
  const regimeColor = { freehold: css('--series-1'), usufruct: css('--series-2'), qatari_only: css('--ink-3') };
  const drawMap = () => {
    layer.clearLayers();
    const vals = current.map((r) => r[mapBy]).filter((x) => x != null && x > 0);
    const max = Math.max(1, ...vals);
    const sorted = vals.slice().sort((x, y) => x - y);
    const q = (p) => sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
    const shade = (x) => css(x >= q(0.75) ? '--seq-4' : x >= q(0.5) ? '--seq-3' : x >= q(0.25) ? '--seq-2' : '--seq-1');
    const pts = [];
    for (const r of current) {
      const x = r[mapBy];
      const has = x != null && x > 0;
      const radius = mapBy === 'deals' || mapBy === 'projects' ? (has ? 5 + 22 * Math.sqrt(x / max) : 4) : 9;
      const fill = mapBy === 'deals' || mapBy === 'projects' ? regimeColor[r.a.regime] : has ? shade(x) : css('--surface-2');
      const ll = [r.a.lat, r.a.lng]; pts.push(ll);
      Leaflet.circleMarker(ll, { radius, weight: 1.5, color: css('--surface'), fillColor: fill, fillOpacity: has ? 0.85 : 0.4 })
        .bindTooltip(`<strong>${esc(L(r.a))}</strong><br>${t(COLS[mapBy][0])}: ${has ? (COLS[mapBy][1] === 'pct' ? pct(x) : nf(x)) : '—'}`)
        .on('click', () => { location.hash = `#/area/${r.a.id}`; }).addTo(layer);
    }
    el.querySelector('#mapNote').textContent = mapBy === 'deals' || mapBy === 'projects' ? t('as.mapSize') : t('as.mapShade');
  };
  el.querySelectorAll('#mapBy [data-m]').forEach((b) => b.addEventListener('click', () => {
    mapBy = b.dataset.m; el.querySelectorAll('#mapBy [data-m]').forEach((x) => x.classList.toggle('on', x === b)); drawMap();
  }));
  el.querySelectorAll('#views [data-v]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.v; store('areasView', view); el.querySelectorAll('#views [data-v]').forEach((x) => x.classList.toggle('on', x === b)); draw();
  }));
  el.querySelectorAll('.filters input, .filters select').forEach((i) => i.addEventListener('input', draw));
  tb.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && e.target.tagName !== 'A') location.hash = `#/area/${tr.dataset.id}`; });
  el.querySelector('#exportBtn').addEventListener('click', () => exportSheets('areas', [{
    name: 'Areas',
    headers: ['Area', 'Municipality', 'Ownership', `Deals (${win.first} to ${win.last})`, 'Sales change, last 26 wk vs same 26 wk a year earlier', 'Value QAR', 'Apartment sales', 'Villa sales', 'Land sales', 'Other sales',
      'Apartment median QAR/sqm (own, 12m)', 'P25', 'P75', 'Apartment sales in median', 'Apartment median change (6m vs year earlier)', 'Average villa price QAR', 'Villa QAR/sqm (plot)', 'Land QAR/sqm',
      'Off-plan projects', 'of which developer-listed', 'Off-plan broker listings', 'Off-plan median asking QAR/sqm', 'Registered resale median QAR/sqm (used for premium)', 'Comparables borrowed', 'Median off-plan premium', 'Pipeline units (this year +3)',
      '1-bed rent QAR/month', '2-bed rent QAR/month', 'Villa rent QAR/month', 'Rent listings', 'Gross yield', 'Yield basis', 'Net yield', 'Livability /100', 'Aircraft noise', 'Location confidence', 'Lat', 'Lng'],
    rows: rows.map((r) => [r.a.name_en, r.a.municipality, r.a.regime, r.deals, round(r.dealsChange, 4), round(r.value), r.units, r.villas, r.land, r.other,
      round(r.aptMedian), round(r.aptP25), round(r.aptP75), r.aptN, round(r.aptYoY, 4), round(r.villaAvg), round(r.villaSqm), round(r.landSqm),
      r.projects, r.devProjects, r.listings, round(r.offplanSqm), round(r.compsMedian), r.compsBorrowed ? 'yes' : '', round(r.premium, 4), r.pipeline,
      r.rent1, r.rent2, r.rentVilla, r.rentN, round(r.grossYield, 4), r.yieldBasis, round(r.netYield, 4), round(r.liv), r.air, r.a.confidence, r.a.lat, r.a.lng]),
  }]));
  draw();
  const b = Leaflet.latLngBounds(rows.map((r) => [r.a.lat, r.a.lng]));
  map.fitBounds(b, { padding: [20, 20] });
}

// Monthly count and value by category, for stacked demand charts.
export function monthlyByCategory(tx) {
  const months = {};
  for (const r of tx) {
    const m = r.week.slice(0, 7);
    const row = (months[m] ||= Object.fromEntries(CATS.flatMap((c) => [[c, 0], [`${c}_v`, 0]])));
    row[catOf(r.property_type)] += r.count;
    row[`${catOf(r.property_type)}_v`] += r.value_qar;
  }
  return Object.keys(months).sort().map((m) => ({ month: m, ...months[m] }));
}

export function renderArea(el, data, id) {
  const a = data.areaById[id];
  if (!a) { el.innerHTML = `<div class="card empty">${t('empty.notFound')}</div>`; return; }
  const tx = (data.txByArea[id] || []).slice().sort((x, y) => x.week.localeCompare(y.week));
  const stats = statsForArea(data, id);
  const { areaId: compsId, deals } = data.compsFor(id);
  const trend = monthlyMedians(deals).filter((m) => m.n >= 3);
  const monthly = monthlyByCategory(tx);
  const rents = data.rentsFor(id);
  const pipeline = (data.pipelineByArea[id] || []).slice().sort((x, y) => x.year - y.year);
  const projects = data.projectsByArea[id] || [];
  const compsName = data.areaById[compsId] ? L(data.areaById[compsId]) : '';
  const sm = areaSummary(data, a, windowWeeks(data), getAssumptions());
  // Villa and land price per sqm of plot by month, where no apartments trade (count-weighted weekly medians).
  const plotTrend = (() => {
    const by = {};
    for (const r of tx) {
      if (!r.ppsqm_median_qar || !['villa', 'land'].includes(r.property_type)) continue;
      ((by[r.week.slice(0, 7)] ||= { villa: [], land: [] })[r.property_type]).push([r.ppsqm_median_qar, r.count]);
    }
    const wm = (p) => { if (p.reduce((s, [, c]) => s + c, 0) < 3) return null; p.sort((x, y) => x[0] - y[0]); const tot = p.reduce((s, [, c]) => s + c, 0); let acc = 0; for (const [v, c] of p) { acc += c; if (acc >= tot / 2) return v; } return null; };
    return Object.keys(by).sort().map((m) => ({ month: m, villa: wm(by[m].villa), land: wm(by[m].land) })).filter((m) => m.villa || m.land);
  })();

  el.innerHTML = `
    <div class="page-head"><div>
      <a href="#/areas" class="small">← ${t('nav.areas')}</a>
      <h1>${esc(L(a))}</h1>
      <div>${regimeBadge(a.regime)} <span class="muted small">${esc(a.municipality)}${a.zone ? ` · ${t('area.zone')} ${esc(a.zone)}` : ''}</span> ${confBadge(a.confidence)}</div>
    </div></div>
    ${a.note_en ? `<p class="muted">${esc(L(a, 'note'))}</p>` : ''}

    <h2 class="section">${t('area.demand')}</h2>
    <div class="grid g-kpi">
      ${kpi(t('col.medianSqm'), stats ? qar(stats.median) : '—', stats ? t('area.iqr', { lo: nf(stats.p25), hi: nf(stats.p75) }) + (stats.borrowed ? ` · ${t('area.compsFrom', { a: esc(compsName) })}` : '') : t('area.noAptSales'))}
      ${kpi(t('as.deals'), nf(sm.deals), `${sm.value ? qarShort(sm.value) : '—'}${sm.dealsChange != null ? ` · ${t('as.dealsChange')} ${deltaSpan(sm.dealsChange)}` : ''}`)}
      ${kpi(t('as.units'), nf(sm.units), sm.aptYoY != null ? `${t('as.aptYoY')} ${deltaSpan(sm.aptYoY)}` : t('kpi.unitsSub'))}
      ${kpi(t('as.villas'), nf(sm.villas), sm.villaAvg ? `${t('as.villaAvg')} ${qarShort(sm.villaAvg)}` : '—')}
      ${kpi(t('as.land'), nf(sm.land), sm.landSqm ? `${t('as.landSqm')} ${nf(sm.landSqm)}` : '—')}
      ${kpi(t('as.grossYield'), sm.grossYield != null ? pct(sm.grossYield) : '—', sm.yieldBasis === 'villa' ? t('as.villaBasis') : sm.netYield != null ? `${t('as.netYield')} ${pct(sm.netYield)}` : '')}
    </div>
    <div class="grid g-2 section">
      <div class="card"><div class="card-head"><h3>${t('area.dealsChart')}</h3><span class="small muted">${t('src.moj')}</span></div>
        ${monthly.length ? `<div class="chart-box"><canvas id="cDeals"></canvas></div>
        ${tableView([t('col.month'), ...CATS.map((c) => t(`ptype.${c}`))], monthly.map((m) => [m.month, ...CATS.map((c) => nf(m[c]))]))}` : `<p class="muted">${t('overview.noData')}</p>`}
        ${sourceNote({ source: data.raw.transactions.source, source_url: data.raw.transactions.source_url, as_of: data.raw.transactions.as_of })}</div>
      <div class="card"><div class="card-head"><h3>${t('area.priceChart')}</h3>${stats?.borrowed ? `<span class="small muted">${esc(compsName)}</span>` : ''}</div>
        ${trend.length ? `<div class="chart-box"><canvas id="cPrice"></canvas></div>
        ${tableView([t('col.month'), t('col.medianSqm'), t('col.deals')], trend.map((m) => [m.month, nf(m.median), nf(m.n)]))}` : plotTrend.length ? `<p class="small muted">${t('area.plotTrend')}</p><div class="chart-box"><canvas id="cPlot"></canvas></div>
        ${tableView([t('col.month'), t('as.villaSqm'), t('as.landSqm')], plotTrend.map((m) => [m.month, m.villa ? nf(m.villa) : '—', m.land ? nf(m.land) : '—']))}` : `<p class="muted">${t('overview.noData')}</p>`}
        ${calcPanel(t('calc.how'), `<p>${t('calc.areaMedianBody')}</p>${stats ? `<p>${t('calc.window', { from: dateFmt(stats.from), to: dateFmt(stats.to), n: stats.n_deals })}</p>
          <p><code>P10 ${nf(stats.p10)} · P25 ${nf(stats.p25)} · P50 ${nf(stats.median)} · P75 ${nf(stats.p75)} · P90 ${nf(stats.p90)}</code></p>` : ''}`)}</div>
    </div>

    <h2 class="section">${t('area.supply')}</h2>
    <div class="grid g-2">
      <div class="card"><div class="card-head"><h3>${t('area.pipelineChart')}</h3></div>
        ${pipeline.length ? `<div class="chart-box"><canvas id="cPipe"></canvas></div>
        ${tableView([t('col.year'), t('col.units')], pipeline.map((p) => [p.year, nf(p.units)]))}${sourceNote(pipeline[0])}` : `<p class="muted">${t('area.noPipeline')}</p>`}</div>
      <div class="card"><div class="card-head"><h3>${t('area.projects')}</h3><span class="muted small">${nf(projects.length)}</span></div>
        ${projects.length ? `<div class="table-wrap"><table><thead><tr><th>${t('col.project')}</th><th>${t('col.developer')}</th><th>${t('col.handover')}</th><th class="num">${t('col.units')}</th></tr></thead><tbody>
          ${projects.map((p) => `<tr><td><a href="#/project/${p.id}">${esc(L(p))}</a></td><td>${esc(p.developer)}</td><td>${handoverCell(p, data)}</td><td class="num">${nf(p.units_total)}</td></tr>`).join('')}
        </tbody></table></div>` : `<p class="muted">${t('area.noProjects')}</p>`}</div>
    </div>

    <h2 class="section">${t('area.rents')}</h2>
    <div class="card table-wrap">
      ${rents.length ? `<table><thead><tr><th>${t('col.type')}</th><th class="num">${t('col.rentMedian')}</th><th class="num">${t('col.rentRange')}</th><th class="num">${t('col.size')}</th><th class="num">${t('col.yield')}</th></tr></thead><tbody>
        ${rents.map((r) => {
          const price = stats && r.typical_size_sqm && r.unit_type !== 'villa' ? stats.median * r.typical_size_sqm : null;
          return `<tr><td>${t(`utype.${r.unit_type}`)}</td><td class="num">${qar(r.median_qar_month)}</td>
            <td class="num">${r.min_qar_month ? `${nf(r.min_qar_month)}–${nf(r.max_qar_month)}` : '—'}</td>
            <td class="num">${r.typical_size_sqm ? nf(r.typical_size_sqm) : '—'}</td>
            <td class="num">${pct(grossYield(price, r.median_qar_month))}</td></tr>`;
        }).join('')}</tbody></table>
        <p class="small muted">${t('area.rentCaveat')}</p>${sourceNote(rents[0])}
        ${calcPanel(t('calc.how'), `<p>${t('calc.areaYieldBody')}</p>`)}` : `<p class="muted">${t('area.noRents')}</p>`}
    </div>

    <h2 class="section">${t('area.location')}</h2>
    <div class="grid g-2">${livabilityCard(a, data)}${noiseCard(a, data)}</div>
    <div class="card section"><div id="map" class="map"></div>${mapLegend()}</div>`;

  if (monthly.length) {
    chart(el.querySelector('#cDeals'), {
      labels: monthly.map((m) => m.month), stacked: true,
      datasets: CATS.map((c, i) => ({ label: t(`ptype.${c}`), data: monthly.map((m) => m[c]), color: css(`--series-${i + 1}`) })),
      yFormat: nf,
    });
  }
  if (trend.length) {
    chart(el.querySelector('#cPrice'), { type: 'line', labels: trend.map((m) => m.month),
      datasets: [{ label: t('col.medianSqm'), data: trend.map((m) => m.median), pointRadius: 3 }], yFormat: nf });
  }
  if (!trend.length && plotTrend.length) {
    chart(el.querySelector('#cPlot'), { type: 'line', labels: plotTrend.map((m) => m.month), yFormat: nf,
      datasets: [{ label: t('as.villaSqm'), data: plotTrend.map((m) => m.villa), pointRadius: 3, color: css('--series-2'), spanGaps: true },
        { label: t('as.landSqm'), data: plotTrend.map((m) => m.land), pointRadius: 3, color: css('--series-3'), spanGaps: true }] });
  }
  if (pipeline.length) chart(el.querySelector('#cPipe'), { labels: pipeline.map((p) => p.year), datasets: [{ label: t('col.units'), data: pipeline.map((p) => p.units) }], yFormat: nf });
  locationMap(el.querySelector('#map'), a, data, { zoom: 13, label: L(a) });
}

function kpi(label, value, sub) {
  return `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub || ''}</div></div>`;
}
