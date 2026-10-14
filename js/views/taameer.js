import { t, L, nf, pct, dateFmt, km } from '../i18n.js';
import { scatterChart, esc, css, kpi, premSpan, exportBtn, calcPanel, qualityBadge, handoverCell, handoverAlt } from '../ui.js';
import { unitComps, projectPremium, fromPrice, unitYieldsNet, quantile } from '../calc/pricing.js';
import { distanceM } from '../calc/geo.js';
import { getAssumptions, assumptionsLine } from '../settings.js';
import { planSummary } from './focus.js';
import { exportSheets, round } from '../export.js';

import { NOT_APARTMENT as NOT_APT } from '../calc/pricing.js';
export const COMPETITOR_RADIUS_M = 2500;
export const MAX_COMPETITORS = 12;

// Competitors: other developers' pipeline projects within 2.5 km (or in the same area when either has no location),
// nearest first, at most 12.
export function competitorsOf(data, tp) {
  return data.projects.filter((p) => !p.taameer && p.status !== 'completed' && p.segment !== 'commercial')
    .map((p) => ({ p, d: tp.lat != null && p.lat != null ? distanceM(tp, p) : null }))
    .filter(({ p, d }) => (d != null ? d <= COMPETITOR_RADIUS_M : p.area_id === tp.area_id))
    .sort((x, y) => (x.d ?? 0) - (y.d ?? 0)).slice(0, MAX_COMPETITORS)
    .map(({ p, d }) => ({ ...p, _dist: d })); // copy: distances differ per Taameer project
}

function summary(data, p, a) {
  const units = unitComps(data, p).filter((u) => u.ppsqm && !NOT_APT.has(u.unit.type));
  const ys = unitYieldsNet(p, data.rentsFor(p.area_id), a).filter((y) => y.net != null);
  return {
    p, from: fromPrice(p),
    ppsqm: units.length ? quantile(units.map((u) => u.ppsqm).sort((x, y) => x - y), 0.5) : null,
    size: units.length ? quantile(units.map((u) => u.unit.size_sqm_min).sort((x, y) => x - y), 0.5) : null,
    prem: projectPremium(data, p)?.premium ?? null,
    plan: planSummary(p),
    net: ys.length ? quantile(ys.map((y) => y.net).sort((x, y) => x - y), 0.5) : null,
    units,
  };
}

export function renderTaameer(el, data) {
  const a = getAssumptions();
  const tps = data.taameerProjects;
  const blocks = tps.map((tp) => {
    const me = summary(data, tp, a);
    const comps = competitorsOf(data, tp).map((p) => summary(data, p, a));
    const field = (k) => quantile(comps.map((c) => c[k]).filter((x) => x != null).sort((x, y) => x - y), 0.5);
    const rankPpsqm = me.ppsqm == null ? null : 1 + comps.filter((c) => c.ppsqm != null && c.ppsqm > me.ppsqm).length;
    return { tp, me, comps, med: { ppsqm: field('ppsqm'), size: field('size'), prem: field('prem'), net: field('net'), down: quantile(comps.map((c) => c.plan?.down).filter((x) => x != null).sort((x, y) => x - y), 0.5), byH: quantile(comps.map((c) => c.plan?.byHandover).filter((x) => x != null).sort((x, y) => x - y), 0.5) }, rankPpsqm };
  });

  el.innerHTML = `
    <div class="page-head"><div><h1>${t('taameer.title')}</h1><p class="muted">${t('taameer.lede')}</p></div>
      <div class="page-actions"><a class="btn secondary" href="data/taameer_projects.csv" download>⤓ ${t('taameer.template')}</a>${exportBtn()}</div></div>
    ${tps.some((x) => x.fromListing) ? `<p class="note-box">${t('taameer.prefilled')}</p>` : ''}
    ${!tps.length ? `<div class="card empty">${t('taameer.empty')}</div>` : ''}
    ${blocks.map((b, i) => `
    <section class="tp-card section">
      <div class="page-head"><div><h2>${esc(L(b.tp))}</h2>
        <div class="small muted">${esc(L(data.areaById[b.tp.area_id]))} · ${t(`status.${b.tp.status}`)} · ${t('col.handover')} ${handoverCell(b.tp, data)} · ${esc(b.tp.source || '')} ${b.tp.as_of ? `(${dateFmt(b.tp.as_of)})` : ''}
        ${b.tp.listing_id ? ` · <a href="#/project/${b.tp.listing_id}">${t('taameer.listing')}</a>` : ''}</div></div></div>
      <div class="grid g-kpi">
        ${kpi(t('col.priceSqm'), nf(b.me.ppsqm), `${t('taameer.field')} ${nf(b.med.ppsqm)}${b.rankPpsqm ? ` · ${t('taameer.rank', { r: b.rankPpsqm, n: b.comps.filter((c) => c.ppsqm != null).length + 1 })}` : ''}`)}
        ${kpi(t('col.premium'), premSpan(b.me.prem), `${t('taameer.field')} ${premSpan(b.med.prem)}`, 'accent')}
        ${kpi(t('taameer.size'), b.me.size ? `${nf(b.me.size)} ${t('unit.sqm')}` : '—', `${t('taameer.field')} ${nf(b.med.size)} ${t('unit.sqm')}`)}
        ${kpi(t('plan.down'), pct(b.me.plan?.down, 0), `${t('taameer.field')} ${pct(b.med.down, 0)}`)}
        ${kpi(t('plan.byHandover'), pct(b.me.plan?.byHandover, 0), `${t('taameer.field')} ${pct(b.med.byH, 0)}`)}
        ${kpi(t('col.netYield'), pct(b.me.net), `${t('taameer.field')} ${pct(b.med.net)}`)}
      </div>
      <div class="section">
        <div class="card table-wrap">
          <div class="card-head"><h3>${t('taameer.competitors', { n: b.comps.length })}</h3><span class="small muted">${t('taameer.compRule', { km: COMPETITOR_RADIUS_M / 1000, n: MAX_COMPETITORS })}</span></div>
          <table><thead><tr><th>${t('col.project')}</th><th>${t('col.developer')}</th><th>${t('col.handover')}</th><th class="num">${t('col.fromPrice')}</th><th class="num">${t('col.priceSqm')}</th>
            <th class="num">${t('col.premium')}</th><th class="num">${t('plan.down')}</th><th class="num">${t('plan.byHandover')}</th><th class="num">${t('col.netYield')}</th><th class="num">${t('col.distance')}</th></tr></thead>
          <tbody>
            <tr class="taameer"><td><strong>${esc(L(b.tp))}</strong></td><td>TAAMEER</td><td>${handoverCell(b.tp, data)}</td><td class="num">${nf(b.me.from)}</td><td class="num">${nf(b.me.ppsqm)}</td>
              <td class="num">${premSpan(b.me.prem)}</td><td class="num">${pct(b.me.plan?.down, 0)}</td><td class="num">${pct(b.me.plan?.byHandover, 0)}</td><td class="num">${pct(b.me.net)}</td><td class="num">—</td></tr>
            ${b.comps.map((c) => `<tr><td><a href="#/project/${c.p.id}">${esc(L(c.p))}</a> ${qualityBadge(c.p)}</td><td>${esc(c.p.developer)}</td><td>${handoverCell(c.p, data)}</td>
              <td class="num">${nf(c.from)}</td><td class="num">${nf(c.ppsqm)}</td><td class="num">${premSpan(c.prem)}</td><td class="num">${pct(c.plan?.down, 0)}</td><td class="num">${pct(c.plan?.byHandover, 0)}</td><td class="num">${pct(c.net)}</td><td class="num">${km(c.p._dist)}</td></tr>`).join('')}
          </tbody></table>
        </div>
        <div class="card section"><div class="card-head"><h3>${t('taameer.scatter')}</h3></div><div class="chart-box tall"><canvas id="sc${i}"></canvas></div></div>
      </div>
    </section>`).join('')}
    <p class="small muted section">${t('taameer.note')} ${esc(assumptionsLine())}</p>
    ${calcPanel(t('calc.how'), `<p>${t('calc.taameerBody')}</p>`)}`;

  blocks.forEach((b, i) => {
    const pt = (u, p) => ({ x: u.unit.size_sqm_min, y: u.ppsqm, label: `${L(p)} · ${t(`utype.${u.unit.type}`)}`, href: p.internal ? (p.listing_id ? `#/project/${p.listing_id}` : null) : `#/project/${p.id}` });
    scatterChart(el.querySelector(`#sc${i}`), {
      datasets: [
        { label: t('taameer.competitorUnits'), color: css('--series-1'), points: b.comps.flatMap((c) => c.units.map((u) => pt(u, c.p))) },
        { label: L(b.tp), color: css('--accent'), border: css('--navy'), style: 'rectRot', radius: 9, points: b.me.units.map((u) => pt(u, b.tp)) },
      ],
      xFormat: (v) => nf(v), yFormat: (v) => nf(v), xTitle: t('col.size'), yTitle: t('col.priceSqm'),
      onClick: (d) => { if (d.href) location.hash = d.href; },
    });
  });

  el.querySelector('#exportBtn').addEventListener('click', () => exportSheets('taameer-positioning', blocks.map((b) => ({
    name: b.tp.name_en,
    headers: ['Project', 'Developer', 'Taameer', 'Distance m', 'Handover', 'Handover per 3+ brokers', 'From price QAR', 'Median QAR/sqm', 'Median size sqm', 'Premium vs like-for-like', 'Down payment', 'Paid by handover', 'After handover', 'Median net yield'],
    rows: [b.me, ...b.comps].map((c) => [c.p.name_en, c.p.developer, c.p.taameer ? 'yes' : '', c.p.taameer ? 0 : round(c.p._dist), c.p.handover, handoverAlt(c.p, data)?.value ?? '', c.from, round(c.ppsqm), round(c.size), round(c.prem, 4), round(c.plan?.down, 4), round(c.plan?.byHandover, 4), round(c.plan?.after, 4), round(c.net, 4)]),
  }))));
}
