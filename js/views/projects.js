import { t, L, nf, qar, pct, dateFmt, store, storedJSON, monthFmt } from '../i18n.js';
import { chart, esc, regimeBadge, sourceNote, calcPanel, tableView, confBadge, css, kpi, premSpan, deltaSpan, qualityBadge, starBtn, exportBtn, toast, handoverCell, handoverAlt } from '../ui.js';
import { statsForArea, pricePosition, projectPricePerSqm, unitComps, projectPremium, unitYieldsNet, fromPrice, bandName } from '../calc/pricing.js';
import { buildCashflow } from '../calc/cashflow.js';
import { facadeSunAllSeasons, ORIENTATIONS, heatRating, obstructionAltitude } from '../calc/sun.js';
import { getAssumptions, assumptionsLine } from '../settings.js';
import { isWatched } from '../watch.js';
import { exportSheets, round } from '../export.js';
import { planSummary } from './focus.js';
import { livabilityCard, noiseCard, locationMap, mapLegend } from './shared.js';

export function getCompare() { return storedJSON('compare', []); }
export function setCompare(ids) { store('compare', JSON.stringify(ids.slice(0, 4))); }

export function sourceBadge(p) {
  const bl = p.broker_listings;
  if (p.source_kind === 'broker') return `<span class="badge q" title="${esc(t('src.brokerTip'))}">${esc(t('src.brokerBadge', { n: bl?.listings ?? 0 }))}</span>`;
  if (bl) return `<span class="badge q" title="${esc(t('src.alsoTip'))}">+${nf(bl.listings)} ${esc(t('src.alsoShort'))}</span>`;
  return '';
}

export function bandLabel(band) {
  const cls = band === 'within' ? '' : band === 'above' ? 'warn' : '';
  return `<span class="badge ${cls}">${t(`band.${band}`)}</span>`;
}

// History helpers: [date, from_price, ppsqm, stock, status, handover]
export function historyOf(data, id) { return data.history?.records?.[id] || []; }
export function priceChange(data, id) {
  const h = historyOf(data, id).filter((x) => x[1]);
  if (h.length < 2) return null;
  return h[h.length - 1][1] / h[0][1] - 1;
}
export function handoverSlips(data, id) {
  const h = historyOf(data, id).filter((x) => x[5]);
  let slips = 0, months = 0;
  for (let i = 1; i < h.length; i++) {
    if (h[i][5] > h[i - 1][5]) {
      slips++;
      const [y1, m1] = h[i - 1][5].split('-').map(Number), [y2, m2] = h[i][5].split('-').map(Number);
      months += (y2 - y1) * 12 + (m2 - m1);
    }
  }
  return { slips, months, first: h[0]?.[5] || null };
}

export function projectRow(data, p, a = getAssumptions()) {
  const area = data.areaById[p.area_id] || {};
  const pr = projectPremium(data, p);
  const y = unitYieldsNet(p, data.rentsFor(p.area_id), a).filter((x) => x.net != null).sort((x, z) => z.net - x.net)[0] || null;
  const plan = planSummary(p);
  return { p, area, from: fromPrice(p), ppsqm: projectPricePerSqm(p), prem: pr?.premium ?? null, premFallback: pr?.fallback, bestNet: y, plan, chg: priceChange(data, p.id) };
}

export function renderProjects(el, data, query = '') {
  const qs = new URLSearchParams(query);
  const a = getAssumptions();
  const years = [...new Set(data.projects.map((p) => (p.handover || '').slice(0, 4)).filter(Boolean))].sort();
  const devs = [...new Set(data.projects.map((p) => p.developer))].sort();
  const rows = data.projects.map((p) => projectRow(data, p, a));
  let group = qs.get('group') || 'pipeline';
  let sortKey = 'handover', sortDir = 1;

  el.innerHTML = `
    <div class="page-head"><div><h1>${t('projects.title')}</h1><p class="muted">${t('projects.lede2')}</p></div>
      <div class="page-actions"><a id="cmpBtn" class="btn" href="#/compare">${t('nav.compare')}</a>${exportBtn()}</div></div>
    <div class="filters">
      <div class="seg" role="tablist">${['pipeline', 'delivered', 'all'].map((g) => `<button type="button" data-g="${g}" class="${g === group ? 'on' : ''}">${t(`group.${g}`)}</button>`).join('')}</div>
      <label class="field">${t('filter.search')}<input id="q" type="search"></label>
      <label class="field">${t('col.area')}<select id="area"><option value="">${t('filter.all')}</option>
        ${data.areas.filter((x) => data.projectsByArea[x.id]).sort((x, y) => L(x).localeCompare(L(y))).map((x) => `<option value="${x.id}">${esc(L(x))}</option>`).join('')}</select></label>
      <label class="field">${t('col.developer')}<select id="dev"><option value="">${t('filter.all')}</option>${devs.map((d) => `<option>${esc(d)}</option>`).join('')}</select></label>
      <label class="field">${t('col.handover')}<select id="yr"><option value="">${t('filter.all')}</option>${years.map((y) => `<option>${y}</option>`).join('')}</select></label>
      <label class="field">${t('filter.regime')}<select id="regime"><option value="">${t('filter.all')}</option>
        ${['freehold', 'usufruct', 'qatari_only'].map((r) => `<option value="${r}">${t(`regime.${r}`)}</option>`).join('')}</select></label>
      <label class="field">${t('src.kind')}<select id="src"><option value="">${t('filter.all')}</option><option value="developer">${t('src.developer')}</option><option value="broker">${t('src.broker')}</option></select></label>
      <label class="field">${t('seg.label')}<select id="seg"><option value="residential">${t('seg.residential')}</option><option value="commercial">${t('seg.commercial')}</option><option value="">${t('filter.all')}</option></select></label>
      <label class="switch"><input id="watchOnly" type="checkbox"> ★ ${t('watch.only')}</label>
    </div>
    <div class="card table-wrap"><table>
      <thead><tr><th></th><th>${t('nav.compare')}</th>
        ${[['name', 'col.project'], ['area', 'col.area'], ['developer', 'col.developer'], ['handover', 'col.handover'], ['units', 'col.units', 'num'], ['from', 'col.fromPrice', 'num'],
          ['ppsqm', 'col.priceSqm', 'num'], ['prem', 'col.premium', 'num'], ['net', 'col.bestNet', 'num'], ['byH', 'plan.byHandover', 'num']]
          .map(([k, lbl, cls]) => `<th class="${cls || ''}" data-sort="${k}" style="cursor:pointer">${t(lbl)} <span class="mini" data-arrow="${k}"></span></th>`).join('')}</tr></thead>
      <tbody id="tb"></tbody></table></div>
    <p class="small muted">${t('projects.note')} ${esc(assumptionsLine())}</p>`;

  const tb = el.querySelector('#tb');
  const cmpBtn = el.querySelector('#cmpBtn');
  const syncBtn = () => {
    const ids = getCompare();
    cmpBtn.textContent = `${t('nav.compare')} (${ids.length})`;
    cmpBtn.href = `#/compare?ids=${ids.join(',')}`;
  };
  const val = {
    name: (r) => L(r.p), area: (r) => L(r.area), developer: (r) => r.p.developer, handover: (r) => r.p.handover || '9999',
    units: (r) => r.p.units_total ?? -1, from: (r) => r.from ?? -1, ppsqm: (r) => r.ppsqm ?? -1, prem: (r) => r.prem ?? -9,
    net: (r) => r.bestNet?.net ?? -9, byH: (r) => r.plan?.byHandover ?? 9,
  };
  let current = [];
  const draw = () => {
    const v = (id) => el.querySelector(id).value;
    const q = v('#q').trim().toLowerCase();
    const watchOnly = el.querySelector('#watchOnly').checked;
    const sel = getCompare();
    current = rows.filter(({ p, area }) => (group === 'all' || (group === 'delivered') === (p.status === 'completed')) &&
      (!v('#area') || p.area_id === v('#area')) && (!v('#dev') || p.developer === v('#dev')) &&
      (!v('#yr') || (p.handover || '').startsWith(v('#yr'))) && (!v('#regime') || area?.regime === v('#regime')) &&
      (!watchOnly || isWatched(p.id)) && (!v('#src') || (p.source_kind || 'developer') === v('#src')) && (!v('#seg') || (p.segment || 'residential') === v('#seg')) &&
      (!q || `${p.name_en} ${p.name_ar || ''} ${p.developer}`.toLowerCase().includes(q)));
    current.sort((x, y) => { const a1 = val[sortKey](x), b1 = val[sortKey](y); return (typeof a1 === 'string' ? a1.localeCompare(b1) : a1 - b1) * sortDir; });
    el.querySelectorAll('[data-arrow]').forEach((s) => { s.textContent = s.dataset.arrow === sortKey ? (sortDir > 0 ? '▲' : '▼') : ''; });
    tb.innerHTML = current.map(({ p, area, from, ppsqm, prem, premFallback, bestNet, plan }) => `<tr class="${p.taameer ? 'taameer' : ''}">
        <td>${starBtn(p.id)}</td>
        <td><input type="checkbox" data-cmp="${p.id}" ${sel.includes(p.id) ? 'checked' : ''} aria-label="${t('nav.compare')}"></td>
        <td><a href="#/project/${p.id}">${esc(L(p))}</a> ${sourceBadge(p)} ${qualityBadge(p)} ${confBadge(p.confidence)}</td>
        <td>${esc(L(area))}</td><td>${esc(p.developer)}</td><td>${handoverCell(p, data)}</td>
        <td class="num">${p.units_total ? nf(p.units_total) : '—'}</td>
        <td class="num">${from ? nf(from) : '—'}${p.price_basis === 'median_listing' && from ? `<div class="mini">${t('src.medianAsk')}</div>` : ''}</td><td class="num">${ppsqm ? nf(ppsqm) : '—'}</td>
        <td class="num">${premSpan(prem)}${premFallback ? '*' : ''}</td>
        <td class="num">${bestNet ? `${pct(bestNet.net)} <span class="mini">${t(`utype.${bestNet.type}`)}</span>` : '—'}</td>
        <td class="num">${plan ? pct(plan.byHandover, 0) : '—'}</td></tr>`).join('') || `<tr><td colspan="12" class="empty">${t('empty.filter')}</td></tr>`;
    syncBtn();
  };
  el.querySelectorAll('.filters input, .filters select').forEach((i) => i.addEventListener('input', draw));
  el.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => {
    group = b.dataset.g;
    el.querySelectorAll('[data-g]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  el.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    sortDir = sortKey === k ? -sortDir : 1; sortKey = k; draw();
  }));
  tb.addEventListener('change', (e) => {
    const id = e.target.dataset.cmp; if (!id) return;
    const ids = getCompare().filter((x) => x !== id);
    if (e.target.checked) { if (ids.length >= 4) { e.target.checked = false; toast(t('compare.max')); return; } ids.push(id); }
    setCompare(ids); syncBtn();
  });
  el.querySelector('#exportBtn').addEventListener('click', () => exportSheets('projects', [{
    name: 'Projects',
    headers: ['Id', 'Project', 'Source', 'Segment', 'Broker listings', 'Developer', 'Area', 'Ownership', 'Status', 'Handover', 'Handover per 3+ brokers', 'Units', 'Floors', 'From price QAR', 'Avg QAR/sqm', 'Premium vs like-for-like deals',
      'Best net yield', 'Best net yield unit', 'Down payment', 'Paid by handover', 'After handover', 'Location quality', 'Stock', 'Confidence', 'Source URL'],
    rows: current.map(({ p, area, from, ppsqm, prem, bestNet, plan }) => [p.id, p.name_en, p.source_kind || 'developer', p.segment || 'residential', p.broker_listings?.listings ?? null, p.developer, area?.name_en ?? p.pf_location, area?.regime, p.status, p.handover, handoverAlt(p, data)?.value ?? '', p.units_total, p.floors, from, round(ppsqm),
      round(prem, 4), round(bestNet?.net, 4), bestNet?.type, round(plan?.down, 4), round(plan?.byHandover, 4), round(plan?.after, 4), p.location_quality, p.stock, p.confidence, p.source_url]),
  }]));
  draw();
}

function brokerCard(p, data) {
  const bl = p.broker_listings;
  if (!bl) return '';
  const devMed = p.source_kind !== 'broker' ? projectPricePerSqm(p) : null;
  const askMed = bl.unit_mix.length ? bl.unit_mix.reduce((s, u) => s + u.ppsqm_median * u.n, 0) / bl.unit_mix.reduce((s, u) => s + u.n, 0) : null;
  return `<div class="card section table-wrap">
    <div class="card-head"><h3>${t(p.source_kind === 'broker' ? 'broker.title' : 'broker.alsoTitle')}</h3>${bl.search_url ? `<a class="small" href="${esc(bl.search_url)}" target="_blank" rel="noopener">${t('broker.open')}</a>` : ''}</div>
    <p class="small">${t('broker.summary', { n: bl.listings, f: bl.first_sale, u: bl.unstated, b: bl.brokers, d: dateFmt(bl.latest_listed) })}${bl.building && bl.building !== p.name_en ? ` · ${t('broker.building', { b: esc(bl.building) })}` : ''}</p>
    ${bl.unit_mix.length ? `<table><thead><tr><th>${t('col.type')}</th><th class="num">${t('broker.n')}</th><th class="num">${t('broker.medSize')}</th><th class="num">${t('broker.medPrice')}</th><th class="num">${t('broker.minPrice')}</th><th class="num">${t('broker.medPpsqm')}</th></tr></thead><tbody>
      ${bl.unit_mix.map((u) => `<tr><td>${t(`utype.${u.type}`)}</td><td class="num">${nf(u.n)}</td><td class="num">${nf(u.size_sqm_min)}</td><td class="num">${nf(u.price_from_qar)}</td><td class="num">${nf(u.price_min_qar)}</td><td class="num">${nf(u.ppsqm_median)}</td></tr>`).join('')}
    </tbody></table>` : `<p class="muted small">${t('broker.noPrices')}</p>`}
    ${devMed && askMed ? `<p class="small">${t('broker.vsDev', { a: nf(askMed), d: nf(devMed) })} ${premSpan(askMed / devMed - 1)}</p>` : ''}
    ${factsTable(p)}
    <p class="small muted">${t('broker.note')}</p>
  </div>`;
}

const FACT_FIELDS = ['developer', 'handover', 'handover_year', 'floors', 'units_total', 'down_pct', 'handover_pct', 'plan_years', 'post_handover'];
function factsTable(p) {
  const f = p.listing_facts || {};
  const rows = FACT_FIELDS.filter((k) => f[k]);
  if (!rows.length) return '';
  const val = (k, v) => (k === 'down_pct' || k === 'handover_pct' ? `${nf(v, { maximumFractionDigits: 1 })}%` : k === 'post_handover' ? t('facts.yes') : k === 'handover' ? monthFmt(v) : esc(String(v)));
  return `<h4 class="section">${t('facts.title')}</h4>
    <table><thead><tr><th>${t('facts.field')}</th><th>${t('facts.value')}</th><th class="num">${t('facts.brokers')}</th><th>${t('facts.status')}</th></tr></thead><tbody>
    ${rows.map((k) => `<tr><td>${t(`facts.${k}`)}</td><td>${val(k, f[k].value)}</td><td class="num">${f[k].from_name ? t('facts.fromName') : nf(f[k].brokers)}${f[k].direct ? ` · ${t('facts.direct')}` : ''}${f[k].disagreeing_brokers ? ` <span class="mini">(${t('facts.disagree', { n: f[k].disagreeing_brokers })})</span>` : ''}</td>
      <td>${f[k].status === 'accepted' ? `<span class="badge">${t('facts.accepted')}</span>` : `<span class="badge warn">${t('facts.candidate')}</span>`}</td></tr>`).join('')}
    </tbody></table>
    <p class="small muted">${t('facts.rule')}</p>`;
}

export function renderProject(el, data, id) {
  const p = data.projectById[id];
  if (!p) { el.innerHTML = `<div class="card empty">${t('empty.notFound')}</div>`; return; }
  const a = getAssumptions();
  const area = data.areaById[p.area_id] || {};
  const stats = statsForArea(data, p.area_id);
  const ppsqm = projectPricePerSqm(p);
  const pos = pricePosition(ppsqm, stats);
  const comps = unitComps(data, p);
  const pr = projectPremium(data, p);
  const yields = unitYieldsNet(p, data.rentsFor(p.area_id), a);
  const from = fromPrice(p);
  const inCompare = getCompare().includes(p.id);
  const hist = historyOf(data, p.id);
  const chg = priceChange(data, p.id);
  const slip = handoverSlips(data, p.id);
  const ov = p.override;
  const priced = (p.unit_mix || []).map((u, i) => ({ u, i })).filter((x) => x.u.price_from_qar);

  el.innerHTML = `
    <div class="page-head"><div>
      <a href="#/projects" class="small">← ${t('nav.projects')}</a>
      <h1>${starBtn(p.id)} ${esc(L(p))}</h1>
      <div>${esc(p.developer)} · <a href="#/area/${area.id}">${esc(L(area))}</a> ${regimeBadge(area.regime)} ${confBadge(p.confidence)} ${qualityBadge(p)} ${p.taameer ? `<span class="badge">${t('taameer.badge')}</span>` : ''}</div>
    </div>
    <div class="page-actions"><button id="cmp" class="btn ${inCompare ? 'secondary' : ''}">${inCompare ? t('compare.remove') : t('compare.add')}</button>${exportBtn()}</div></div>

    <div class="grid g-kpi">
      ${kpi(t('col.status'), t(`status.${p.status}`), p.stock ? t(`stock.${p.stock}`) : '')}
      ${kpi(t('col.handover'), esc(p.handover ? monthFmt(p.handover) : '—'), [slip.slips ? `<span class="delta down">${t('project.slipped', { n: slip.slips, m: slip.months })}</span>` : '', handoverAlt(p, data) ? `<span style="color:var(--warn)">⚠ ${esc(t('handover.altLong', { d: monthFmt(handoverAlt(p, data).value), n: handoverAlt(p, data).brokers }))}</span>` : ''].filter(Boolean).join('<br>'))}
      ${kpi(t('col.units'), nf(p.units_total), p.floors ? t('project.floors', { n: p.floors }) : '')}
      ${kpi(p.price_basis === 'median_listing' ? t('src.medianAskLong') : t('col.fromPrice'), from ? qar(from) : '—', chg != null ? `${t('project.sinceFirst', { d: dateFmt(hist[0][0]) })} ${deltaSpan(chg)}` : t('project.tracking', { d: dateFmt(data.history?.first) }))}
      ${kpi(t('col.premium'), premSpan(pr?.premium), pr ? t('project.premiumSub', { n: pr.n }) + (pr.fallback ? ' *' : '') : t('project.noComps2'), 'accent')}
    </div>
    ${p.location_quality !== 'building' ? `<p class="note-box section">${t(`loc.${p.location_quality}Note`)}</p>` : ''}
    ${ov ? `<p class="small muted section">${t((ov.layers || []).some((l) => l.layer === 'override') ? 'override.applied' : 'research.applied', { f: esc(ov.fields.join(', ')) })} ${ov.source_url ? `<a href="${esc(ov.source_url)}" target="_blank" rel="noopener">${esc(ov.source)}</a>` : esc(ov.source)}${ov.note ? ` · ${esc(ov.note)}` : ''}</p>` : ''}
    ${sourceNote(p)}
    ${brokerCard(p, data)}

    <h2 class="section">${t('project.pricing')}</h2>
    <div class="card table-wrap">
      <div class="card-head"><h3>${t('project.l4l')}</h3><span class="small muted">${t('project.l4lSub')}</span></div>
      <table><thead><tr><th>${t('col.type')}</th><th class="num">${t('col.size')}</th><th class="num">${t('col.fromPrice')}</th><th class="num">${t('col.priceSqm')}</th>
        <th>${t('col.sizeBand')}</th><th class="num">${t('col.bandMedian')}</th><th class="num">${t('col.deals')}</th><th class="num">${t('col.premium')}</th><th>${t('col.vsArea')}</th></tr></thead><tbody>
      ${comps.map((c) => `<tr><td>${t(`utype.${c.unit.type}`)}</td><td class="num">${nf(c.unit.size_sqm_min)}</td><td class="num">${nf(c.unit.price_from_qar)}</td><td class="num">${nf(c.ppsqm)}</td>
        <td>${c.band != null ? bandName(c.band) : '—'}${c.fallback ? ` <span class="mini">(${t('project.allSizes')})</span>` : ''}</td><td class="num">${nf(c.stats?.median)}</td><td class="num">${nf(c.stats?.n_deals)}</td>
        <td class="num">${premSpan(c.premium)}</td><td>${c.position ? bandLabel(c.position) : '—'}</td></tr>`).join('')}
      </tbody></table>
      ${!comps.some((c) => c.ppsqm) ? `<p class="muted">${t('project.noSized')}</p>` : ''}
      ${calcPanel(t('calc.how'), `<p>${t('calc.l4lBody')}</p>${stats ? `<p>${t('calc.window', { from: dateFmt(stats.from), to: dateFmt(stats.to), n: stats.n_deals })}${stats.borrowed ? ` · ${t('area.compsFrom', { a: esc(L(data.areaById[stats.compsId])) })}` : ''}</p>
        <p><code>${t('project.allArea')}: P25 ${nf(stats.p25)} · P50 ${nf(stats.median)} · P75 ${nf(stats.p75)} · ${t('col.priceSqm')} ${nf(ppsqm)} ${pos ? `(${t(`band.${pos.band}`)})` : ''}</code></p>` : ''}`)}
    </div>

    <div class="grid g-2 section">
      <div class="card table-wrap">
        <h3>${t('project.yields')}</h3>
        <table><thead><tr><th>${t('col.type')}</th><th class="num">${t('col.fromPrice')}</th><th class="num">${t('col.rentMedian')}</th><th class="num">${t('col.sample')}</th><th class="num">${t('col.yield')}</th><th class="num">${t('col.netYield')}</th></tr></thead><tbody>
        ${yields.map((y) => `<tr><td>${t(`utype.${y.type}`)}</td><td class="num">${nf(y.price)}</td><td class="num">${nf(y.rent)}</td>
          <td class="num">${nf(y.sample)}${y.rent && y.smallSample ? ` <span class="badge warn q">${t('yield.small')}</span>` : ''}</td><td class="num">${pct(y.yield)}</td><td class="num">${pct(y.net)}</td></tr>`).join('')}
        </tbody></table>
        <p class="small muted">${t('project.yieldCaveat2')} ${esc(assumptionsLine())}</p>
        ${calcPanel(t('calc.how'), `<p>${t('calc.netYieldBody')}</p>`)}
      </div>
      <div class="card">
        <h3>${t('project.history')}</h3>
        ${hist.filter((x) => x[1]).length >= 2 ? `<div class="chart-box"><canvas id="cHist"></canvas></div>` : `<p class="muted">${t('project.historyOne', { d: dateFmt(data.history?.first) })}</p>`}
        ${tableView([t('col.date'), t('col.fromPrice'), t('col.priceSqm'), t('col.stock'), t('col.handover')], hist.map((h) => [h[0], nf(h[1]), nf(h[2]), h[3] ? t(`stock.${h[3]}`) : '—', h[5] || '—']))}
      </div>
    </div>

    <h2 class="section">${t('cf.title')}</h2>
    <div class="card" id="cfCard">
      ${p.payment_plans?.length && priced.length ? `
      <div class="filters">
        <label class="field">${t('cf.plan')}<select id="cfPlan">${p.payment_plans.map((pl, i) => `<option value="${i}">${esc(pl.label)}: ${pct(pl.down, 0)} / ${pct(pl.during, 0)} / ${pct(pl.handover, 0)} / ${pct(pl.after, 0)}</option>`).join('')}</select></label>
        <label class="field">${t('cf.unit')}<select id="cfUnit">${priced.map(({ u, i }) => `<option value="${i}">${t(`utype.${u.type}`)} · ${qar(u.price_from_qar)}</option>`).join('')}</select></label>
        <label class="field">${t('cf.price')}<input id="cfPrice" type="number" step="1000" min="0"></label>
      </div>
      <div id="cfKpis" class="grid g-kpi"></div>
      <div class="chart-box section"><canvas id="cCf"></canvas></div>
      <div id="cfFlags" class="small muted"></div>
      <div id="cfTable"></div>
      <p class="small muted">${esc(assumptionsLine())} · <a href="#" id="cfSettings">${t('assume.edit')}</a></p>
      ${calcPanel(t('calc.how'), `<p>${t('calc.cfBody')}</p><p class="small">${esc(p.payment_plan_en || '')}</p>`)}`
      : `<p class="muted">${t('cf.none')}</p>${p.payment_plan_en ? `<p>${esc(L(p, 'payment_plan'))}</p>` : ''}`}
    </div>

    <h2 class="section">${t('sun.title')}</h2>
    <div class="card">
      <div class="filters">
        <label class="field">${t('sun.facade')}<select id="facade">${Object.keys(ORIENTATIONS).map((o) => `<option value="${o}" ${o === (p.default_facade || 'S') ? 'selected' : ''}>${t(`dir.${o}`)}</option>`).join('')}</select></label>
        <label class="field">${t('sun.floor')}<input id="floor" type="number" min="0" max="${p.floors || 80}" value="${Math.min(10, p.floors || 10)}"></label>
        <label class="field">${t('sun.density')}<select id="density">${['low', 'medium', 'high'].map((d) => `<option value="${d}" ${d === (area.density || 'medium') ? 'selected' : ''}>${t(`density.${d}`)}</option>`).join('')}</select></label>
      </div>
      <div id="sunKpis" class="grid g-kpi"></div>
      <div class="chart-box section"><canvas id="cSun"></canvas></div>
      <div id="sunTable"></div>
      <p class="small muted">${t('sun.caveat')}</p>
      ${calcPanel(t('calc.how'), `<p>${t('calc.sunBody')}</p><p id="sunCalc"></p>`)}
    </div>

    <h2 class="section">${t('views.title')}</h2>
    <div class="card">
      ${(p.views || []).length ? `<div class="chips">${p.views.map((v) => `<span class="chip">${t(`view.${v}`)}</span>`).join('')}</div>` : `<p class="muted">${t('views.none')}</p>`}
      <p class="small muted">${t('views.note')}</p>
    </div>

    <h2 class="section">${t('area.location')}</h2>
    <div class="grid g-2">${livabilityCard(p, data)}${noiseCard(p, data)}</div>
    <div class="card section"><div id="map" class="map"></div>${mapLegend()}</div>`;

  el.querySelector('#cmp').addEventListener('click', () => {
    const ids = getCompare();
    if (ids.includes(p.id)) setCompare(ids.filter((x) => x !== p.id));
    else if (ids.length >= 4) { toast(t('compare.max')); return; } else setCompare([...ids, p.id]);
    renderProject(el, data, id);
  });

  if (hist.filter((x) => x[1]).length >= 2) {
    const hh = hist.filter((x) => x[1]);
    chart(el.querySelector('#cHist'), { type: 'line', labels: hh.map((h) => dateFmt(h[0])), datasets: [{ label: t('col.fromPrice'), data: hh.map((h) => h[1]), pointRadius: 3 }], yFormat: (v) => nf(v) });
  }

  // ---- Payment plan cash flow ----
  let cfData = null;
  if (p.payment_plans?.length && priced.length) {
    let cfChart;
    const priceIn = el.querySelector('#cfPrice');
    const unitSel = el.querySelector('#cfUnit');
    const setPrice = () => { priceIn.value = p.unit_mix[Number(unitSel.value)].price_from_qar; };
    setPrice();
    const drawCf = () => {
      const plan = p.payment_plans[Number(el.querySelector('#cfPlan').value)];
      const u = p.unit_mix[Number(unitSel.value)];
      const price = Number(priceIn.value) || u.price_from_qar;
      const y = yields[Number(unitSel.value)];
      const cf = buildCashflow({ plan, price, handover: p.handover, rentMonthly: y?.rent, sizeSqm: y?.size, a });
      cfData = { cf, plan, u, price };
      el.querySelector('#cfKpis').innerHTML =
        kpi(t('plan.byHandover'), pct(cf.paidByHandover, 0), t('cf.monthsTo', { n: cf.H })) +
        kpi(t('cf.pv'), qar(cf.pv), t('cf.pvSub', { d: pct(a.discount_rate, 1), x: pct(cf.pvDiscount, 1) })) +
        kpi(t('cf.irr'), cf.irr == null ? '—' : pct(cf.irr), t('cf.irrSub', { y: a.hold_years_after_handover }), 'accent') +
        kpi(t('cf.multiple'), cf.multiple == null ? '—' : `${nf(cf.multiple, { maximumFractionDigits: 2 })}×`, `${t('cf.profit')} ${qar(cf.profit)}`) +
        kpi(t('cf.peak'), qar(cf.peakEquity), y?.rent ? t('cf.rentSub', { r: nf(y.rent) }) : t('cf.noRent'));
      const flags = [...cf.flags.map((f) => t(`cf.flag.${f}`, { n: cf.afterYears })), ...(y?.rent ? [] : [t('cf.flag.noRent')])];
      el.querySelector('#cfFlags').innerHTML = flags.length ? `<p class="note-box">${flags.map(esc).join(' ')}</p>` : '';
      const byYear = {};
      const start = new Date();
      for (const r of cf.rows) {
        const d = new Date(start.getFullYear(), start.getMonth() + r.m, 1);
        const k = d.getFullYear();
        const b = (byYear[k] ||= { pay: 0, fees: 0, rent: 0, exit: 0, settle: 0, net: 0 });
        b.pay += r.pay; b.fees += r.fees; b.rent += r.rent; b.exit += r.exit; b.settle += r.settle; b.net += r.net;
      }
      const yrs = Object.keys(byYear).sort();
      el.querySelector('#cfTable').innerHTML = `<div class="table-wrap section"><table class="cf-table"><thead><tr><th>${t('col.year')}</th><th class="num">${t('cf.payments')}</th><th class="num">${t('cf.fees')}</th><th class="num">${t('cf.rent')}</th><th class="num">${t('cf.exit')}</th><th class="num">${t('cf.net')}</th></tr></thead>
        <tbody>${yrs.map((k) => { const b = byYear[k]; return `<tr><td>${k}</td><td class="num">${nf(-(b.pay + b.settle) || 0)}</td><td class="num">${nf(-b.fees || 0)}</td><td class="num">${nf(b.rent)}</td><td class="num">${nf(b.exit)}</td><td class="num">${nf(b.net)}</td></tr>`; }).join('')}</tbody></table></div>`;
      cfChart?.destroy();
      const labels = cf.rows.map((r) => monthFmt(new Date(start.getFullYear(), start.getMonth() + r.m, 1).toISOString().slice(0, 7)));
      cfChart = chart(el.querySelector('#cCf'), {
        type: 'bar', labels,
        datasets: [
          { label: t('cf.payments'), data: cf.rows.map((r) => -(r.pay + r.fees + r.settle)), color: css('--series-1') },
          { label: t('cf.inflows'), data: cf.rows.map((r) => r.rent + r.exit), color: css('--series-3') },
          { type: 'line', label: t('cf.cumulative'), data: cf.rows.map((r) => r.cum), color: css('--navy'), borderWidth: 2 },
        ],
        yFormat: (v) => nf(v),
      });
    };
    el.querySelector('#cfPlan').addEventListener('input', drawCf);
    unitSel.addEventListener('input', () => { setPrice(); drawCf(); });
    priceIn.addEventListener('input', drawCf);
    el.querySelector('#cfSettings').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('settingsBtn').click(); });
    drawCf();
  }

  el.querySelector('#exportBtn').addEventListener('click', () => {
    const sheets = [
      { name: 'Units', headers: ['Type', 'Size sqm', 'From price QAR', 'QAR/sqm', 'Size band', 'Band median QAR/sqm', 'Band deals', 'Premium', 'All-sizes fallback', 'Median rent QAR/month', 'Rent sample', 'Gross yield', 'Net yield'],
        rows: comps.map((c, i) => [c.unit.type, c.unit.size_sqm_min, c.unit.price_from_qar, round(c.ppsqm), c.band == null ? '' : bandName(c.band), round(c.stats?.median), c.stats?.n_deals, round(c.premium, 4), c.fallback ? 'yes' : '', yields[i].rent, yields[i].sample, round(yields[i].yield, 4), round(yields[i].net, 4)]) },
      { name: 'History', headers: ['Date', 'From price QAR', 'Avg QAR/sqm', 'Stock', 'Status', 'Handover'], rows: hist },
    ];
    if (cfData) {
      sheets.push({ name: 'Cash flow', headers: ['Month', 'Payment', 'Fees', 'Net rent', 'Exit', 'Settle at exit', 'Net', 'Cumulative'],
        rows: cfData.cf.rows.map((r) => [r.m, round(-r.pay), round(-r.fees), round(r.rent), round(r.exit), round(-r.settle), round(r.net), round(r.cum)]) });
      sheets.push({ name: 'Cash flow summary', headers: ['Item', 'Value'], rows: [['Plan', cfData.plan.label], ['Unit', cfData.u.type], ['Price QAR', cfData.price], ['Paid by handover', round(cfData.cf.paidByHandover, 4)],
        ['PV of payments', round(cfData.cf.pv)], ['IRR', round(cfData.cf.irr, 4)], ['Equity multiple', round(cfData.cf.multiple, 3)], ['Peak equity', round(cfData.cf.peakEquity)], ['Assumptions', assumptionsLine()]] });
    }
    exportSheets(`project-${p.id}`, sheets);
  });

  // Sun tool: hours of direct sun for every orientation (summer vs winter), selected one highlighted.
  let sunChart;
  const drawSun = () => {
    const facade = el.querySelector('#facade').value;
    const floor = Number(el.querySelector('#floor').value) || 0;
    const density = el.querySelector('#density').value;
    const all = Object.fromEntries(Object.entries(ORIENTATIONS).map(([k, deg]) => [k, facadeSunAllSeasons({ lat: p.lat, lng: p.lng, facadeDeg: deg, floor, density })]));
    const sel = all[facade];
    el.querySelector('#sunKpis').innerHTML =
      kpi(t('sun.summer'), `${nf(sel.summer.hours, { maximumFractionDigits: 1 })} ${t('unit.h')}`, t('sun.afternoon', { h: nf(sel.summer.afternoonHours, { maximumFractionDigits: 1 }) })) +
      kpi(t('sun.winter'), `${nf(sel.winter.hours, { maximumFractionDigits: 1 })} ${t('unit.h')}`, t('sun.afternoon', { h: nf(sel.winter.afternoonHours, { maximumFractionDigits: 1 }) })) +
      kpi(t('sun.heat'), t(`heat.${heatRating(sel.summer.afternoonHours)}`), t('sun.heatSub'));
    const keys = Object.keys(ORIENTATIONS);
    const dim = (base) => keys.map((k) => (k === facade ? css(base) : css(base) + '66'));
    sunChart?.destroy();
    sunChart = chart(el.querySelector('#cSun'), {
      labels: keys.map((k) => t(`dir.${k}`)),
      datasets: [
        { label: t('sun.summer'), data: keys.map((k) => all[k].summer.hours), backgroundColor: dim('--series-2') },
        { label: t('sun.winter'), data: keys.map((k) => all[k].winter.hours), backgroundColor: dim('--series-1') },
      ],
      yFormat: (v) => `${nf(v, { maximumFractionDigits: 1 })} ${t('unit.h')}`,
    });
    el.querySelector('#sunTable').innerHTML = tableView([t('sun.facade'), t('sun.summer'), t('sun.equinox'), t('sun.winter')],
      keys.map((k) => [t(`dir.${k}`), ...['summer', 'equinox', 'winter'].map((s) => nf(all[k][s].hours, { maximumFractionDigits: 1 }))]));
    el.querySelector('#sunCalc').textContent = t('calc.sunParams', { lat: p.lat.toFixed(4), lng: p.lng.toFixed(4), alt: nf(obstructionAltitude(floor, density), { maximumFractionDigits: 1 }) });
  };
  el.querySelectorAll('#facade, #floor, #density').forEach((i) => i.addEventListener('input', drawSun));
  drawSun();

  locationMap(el.querySelector('#map'), p, data, { zoom: 14, label: L(p) });
}
