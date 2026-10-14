import { t, L, nf, qar, pct, monthFmt } from '../i18n.js';
import { comboChart, scatterChart, esc, css, tableView, calcPanel, kpi, premSpan, exportBtn, qualityBadge, handoverCell } from '../ui.js';
import { monthlyMedians, quantile, SIZE_BANDS, bandName, bandStats, unitComps, projectPremium, netYield, grossYield } from '../calc/pricing.js';
import { buildCashflow } from '../calc/cashflow.js';
import { getAssumptions, assumptionsLine } from '../settings.js';
import { exportSheets, round } from '../export.js';

// Lusail city (including Fox Hills / Jabal Thuaileb) and Qetaifan Island North: 32+ of the tracked projects.
export const FOCUS = ['lusail', 'jabal-thuaileb', 'qetaifan-islands'];
import { NOT_APARTMENT as NOT_APT } from '../calc/pricing.js';

export function planSummary(p) {
  const plan = (p.payment_plans || [])[0];
  if (!plan) return null;
  const a = { ...getAssumptions(), hold_years_after_handover: 0 };
  const cf = buildCashflow({ plan, price: 1, handover: p.handover, a });
  return { plan, byHandover: cf.paidByHandover, after: plan.after, down: plan.down, yearsAfter: cf.afterYears, pvDiscount: cf.pvDiscount, flags: cf.flags };
}

export function renderFocus(el, data) {
  const a = getAssumptions();
  const projects = data.projects.filter((p) => FOCUS.includes(p.area_id));
  const pipeline = projects.filter((p) => p.status !== 'completed');
  const lusailDeals = FOCUS.filter((id) => id !== 'qetaifan-islands').flatMap((id) => data.dealsByArea[id] || []);
  const monthly = monthlyMedians(lusailDeals);
  const counts = {};
  for (const d of lusailDeals) counts[d.date.slice(0, 7)] = (counts[d.date.slice(0, 7)] || 0) + 1;
  const months = monthly.slice(-21);

  // All apartment-type launch units with a price and a size.
  const units = projects.flatMap((p) => unitComps(data, p).filter((x) => x.ppsqm && !NOT_APT.has(x.unit.type)).map((x) => ({ ...x, p })));
  const launchMedian = quantile(units.map((u) => u.ppsqm).sort((x, y) => x - y), 0.5);
  const allLusail = lusailDeals.filter((d) => d.sqm >= 25);
  const latest = allLusail.reduce((m, d) => (d.date > m ? d.date : m), '');
  const cut = new Date(latest); cut.setMonth(cut.getMonth() - 12);
  const reg12 = allLusail.filter((d) => d.date > cut.toISOString().slice(0, 10)).map((d) => d.ppsqm).sort((x, y) => x - y);
  const prem = pipeline.map((p) => projectPremium(data, p)).filter(Boolean).map((x) => x.premium).sort((x, y) => x - y);
  const knownUnits = pipeline.reduce((s, p) => s + (p.units_total || 0), 0);

  const bands = SIZE_BANDS.map((_, i) => {
    const reg = bandStats(data, 'lusail', i);
    const pick = (ids) => units.filter((u) => ids.includes(u.p.area_id) && u.band === i).map((u) => u.ppsqm).sort((x, y) => x - y);
    const lus = pick(['lusail', 'jabal-thuaileb']);
    const qet = pick(['qetaifan-islands']);
    const lm = quantile(lus, 0.5), qm = quantile(qet, 0.5);
    return { i, reg, lus: lus.length, lm, qet: qet.length, qm, lp: reg && lm ? lm / reg.median - 1 : null, qp: reg && qm ? qm / reg.median - 1 : null };
  });

  const plans = pipeline.map((p) => ({ p, s: planSummary(p) })).filter((x) => x.s).sort((x, y) => x.s.byHandover - y.s.byHandover);
  const rents = ['lusail', 'jabal-thuaileb'].flatMap((id) => (data.rentsByArea[id] || []).map((r) => ({ ...r, areaName: L(data.areaById[id]) })));
  const launchByType = (type) => quantile(units.filter((u) => u.unit.type === type).map((u) => u.unit.price_from_qar).sort((x, y) => x - y), 0.5);

  el.innerHTML = `
    <div class="page-head"><div><h1>${t('focus.title')}</h1><p class="muted">${t('focus.lede')}</p></div>
      <div class="page-actions">${exportBtn()}</div></div>
    <div class="grid g-kpi">
      ${kpi(t('focus.pipeline'), nf(pipeline.length), t('focus.pipelineSub', { n: projects.length }))}
      ${kpi(t('focus.units'), nf(knownUnits), t('focus.unitsSub', { k: pipeline.filter((p) => p.units_total).length, n: pipeline.length }))}
      ${kpi(t('focus.launch'), qar(launchMedian), t('focus.launchSub', { n: units.length }))}
      ${kpi(t('focus.registered'), qar(quantile(reg12, 0.5)), t('focus.registeredSub', { n: reg12.length }))}
      ${kpi(t('kpi.premium'), premSpan(quantile(prem, 0.5)), t('kpi.premiumSub', { n: prem.length }), 'accent')}
    </div>

    <div class="grid g-2 section">
      <div class="card">
        <div class="card-head"><h2>${t('focus.dealsChart')}</h2><span class="small muted">${t('src.moj')}</span></div>
        <div class="chart-box tall"><canvas id="cDeals"></canvas></div>
        ${tableView([t('col.month'), t('col.deals'), t('col.medianSqm')], months.map((m) => [m.month, nf(counts[m.month]), nf(m.median)]))}
      </div>
      <div class="card">
        <div class="card-head"><h2>${t('focus.scatter')}</h2><span class="small muted">${t('focus.scatterSub')}</span></div>
        <div class="chart-box tall"><canvas id="cScatter"></canvas></div>
        <p class="small muted">${t('focus.scatterNote')}</p>
      </div>
    </div>

    <div class="card section table-wrap">
      <div class="card-head"><h2>${t('focus.bands')}</h2><span class="small muted">${t('focus.bandsSub')}</span></div>
      <table><thead><tr><th>${t('col.sizeBand')}</th><th class="num">${t('focus.regDeals')}</th><th class="num">P25</th><th class="num">${t('col.median')}</th><th class="num">P75</th>
        <th class="num">${t('focus.lusUnits')}</th><th class="num">${t('focus.lusMedian')}</th><th class="num">${t('col.premium')}</th>
        <th class="num">${t('focus.qetUnits')}</th><th class="num">${t('focus.qetMedian')}</th><th class="num">${t('col.premium')}</th></tr></thead>
      <tbody>${bands.map((b) => `<tr><td>${bandName(b.i)}</td><td class="num">${nf(b.reg?.n_deals)}</td><td class="num">${nf(b.reg?.p25)}</td><td class="num">${nf(b.reg?.median)}</td><td class="num">${nf(b.reg?.p75)}</td>
        <td class="num">${nf(b.lus)}</td><td class="num">${nf(b.lm)}</td><td class="num">${premSpan(b.lp)}</td>
        <td class="num">${nf(b.qet)}</td><td class="num">${nf(b.qm)}</td><td class="num">${premSpan(b.qp)}</td></tr>`).join('')}</tbody></table>
      ${calcPanel(t('calc.how'), `<p>${t('calc.bandsBody')}</p>`)}
    </div>

    <div class="grid g-2 section">
      <div class="card table-wrap">
        <div class="card-head"><h2>${t('focus.plans')}</h2><span class="small muted">${t('focus.plansSub')}</span></div>
        <table><thead><tr><th>${t('col.project')}</th><th>${t('col.handover')}</th><th class="num">${t('plan.down')}</th><th class="num">${t('plan.byHandover')}</th><th class="num">${t('plan.after')}</th><th class="num">${t('plan.pvDiscount')}</th></tr></thead>
        <tbody>${plans.map(({ p, s }) => `<tr class="${p.taameer ? 'taameer' : ''}"><td><a href="#/project/${p.id}">${esc(L(p))}</a><div class="mini">${esc(p.developer)}</div></td><td>${handoverCell(p, data)}</td>
          <td class="num">${pct(s.down, 0)}</td><td class="num">${pct(s.byHandover, 0)}</td><td class="num">${pct(s.after, 0)}${s.after ? ` <span class="mini">${t('plan.yrs', { n: s.yearsAfter })}</span>` : ''}</td><td class="num">${pct(s.pvDiscount, 1)}</td></tr>`).join('')}</tbody></table>
        <p class="small muted">${t('plan.tableNote')} ${esc(assumptionsLine())}</p>
      </div>
      <div class="card table-wrap">
        <div class="card-head"><h2>${t('focus.rents')}</h2><span class="small muted">${t('src.pf')}</span></div>
        <table><thead><tr><th>${t('col.area')}</th><th>${t('col.type')}</th><th class="num">${t('col.rentMedian')}</th><th class="num">${t('col.sample')}</th><th class="num">${t('focus.launchPrice')}</th><th class="num">${t('col.yield')}</th><th class="num">${t('col.netYield')}</th></tr></thead>
        <tbody>${rents.map((r) => { const price = launchByType(r.unit_type); return `<tr><td>${esc(r.areaName)}</td><td>${t(`utype.${r.unit_type}`)}</td><td class="num">${nf(r.median_qar_month)}</td>
          <td class="num">${nf(r.sample)}${r.sample < 15 ? ' <span class="badge warn q">' + t('yield.small') + '</span>' : ''}</td><td class="num">${nf(price)}</td><td class="num">${pct(grossYield(price, r.median_qar_month))}</td><td class="num">${pct(netYield(price, r.median_qar_month, r.typical_size_sqm, a))}</td></tr>`; }).join('')}</tbody></table>
        <p class="small muted">${t('focus.rentsNote')}</p>
      </div>
    </div>

    <div class="card section table-wrap">
      <div class="card-head"><h2>${t('focus.projects')}</h2></div>
      <table><thead><tr><th>${t('col.project')}</th><th>${t('col.area')}</th><th>${t('col.developer')}</th><th>${t('col.handover')}</th><th class="num">${t('col.units')}</th><th class="num">${t('col.priceSqm')}</th><th class="num">${t('col.premium')}</th></tr></thead>
      <tbody>${pipeline.slice().sort((x, y) => String(x.handover || '9').localeCompare(String(y.handover || '9'))).map((p) => { const pr = projectPremium(data, p); const u = unitComps(data, p).filter((x) => x.ppsqm); const pp = u.length ? u.reduce((s, x) => s + x.ppsqm, 0) / u.length : null;
        return `<tr class="${p.taameer ? 'taameer' : ''}"><td><a href="#/project/${p.id}">${esc(L(p))}</a> ${qualityBadge(p)}</td><td>${esc(L(data.areaById[p.area_id]))}</td><td>${esc(p.developer)}</td><td>${handoverCell(p, data)}</td><td class="num">${nf(p.units_total)}</td><td class="num">${nf(pp)}</td><td class="num">${premSpan(pr?.premium)}</td></tr>`; }).join('')}</tbody></table>
    </div>`;

  comboChart(el.querySelector('#cDeals'), {
    labels: months.map((m) => monthFmt(m.month)),
    bars: { label: t('col.deals'), data: months.map((m) => counts[m.month] || 0) },
    line: { label: t('col.medianSqm'), data: months.map((m) => (m.n >= 3 ? m.median : null)) },
    yFormat: (v) => nf(v), y2Format: (v) => nf(v),
  });

  const colors = { lusail: css('--series-1'), 'jabal-thuaileb': css('--series-3'), 'qetaifan-islands': css('--series-4') };
  const pt = (u) => ({ x: u.unit.size_sqm_min, y: u.ppsqm, label: `${L(u.p)} · ${t(`utype.${u.unit.type}`)}`, href: `#/project/${u.p.id}` });
  const sets = FOCUS.map((id) => ({ label: L(data.areaById[id]), color: colors[id], points: units.filter((u) => u.p.area_id === id && !u.p.taameer).map(pt) }));
  sets.push({ label: t('focus.taameerUnits'), color: css('--accent'), border: css('--navy'), style: 'rectRot', radius: 8, points: units.filter((u) => u.p.taameer).map(pt) });
  const regLine = SIZE_BANDS.map(([lo, hi], i) => ({ i, s: bandStats(data, 'lusail', i), x: hi === Infinity ? lo + 60 : (lo + hi) / 2 })).filter((b) => b.s)
    .map((b) => ({ x: b.x, y: b.s.median, label: `${t('focus.regMedian')} ${bandName(b.i)}` }));
  sets.push({ label: t('focus.regMedian'), color: css('--ink-2'), border: css('--ink-2'), radius: 3, points: regLine, extra: { showLine: true, borderWidth: 2, borderDash: [6, 4] } });
  scatterChart(el.querySelector('#cScatter'), {
    datasets: sets, xFormat: (v) => `${nf(v)}`, yFormat: (v) => nf(v), xTitle: t('col.size'), yTitle: t('col.priceSqm'),
    onClick: (d) => { if (d.href) location.hash = d.href; },
  });

  el.querySelector('#exportBtn').addEventListener('click', () => exportSheets('lusail-qetaifan', [
    { name: 'Size bands', headers: ['Size band', 'Registered deals (Lusail, 12m)', 'P25', 'Median', 'P75', 'Lusail launch units', 'Lusail launch median QAR/sqm', 'Lusail premium', 'Qetaifan launch units', 'Qetaifan launch median QAR/sqm', 'Qetaifan premium'],
      rows: bands.map((b) => [bandName(b.i), b.reg?.n_deals, round(b.reg?.p25), round(b.reg?.median), round(b.reg?.p75), b.lus, round(b.lm), round(b.lp, 4), b.qet, round(b.qm), round(b.qp, 4)]) },
    { name: 'Launch units', headers: ['Project', 'Developer', 'Area', 'Unit type', 'Size sqm', 'From price QAR', 'QAR/sqm', 'Size band', 'Band median QAR/sqm', 'Premium', 'Band fallback'],
      rows: units.map((u) => [u.p.name_en, u.p.developer, u.p.area_id, u.unit.type, u.unit.size_sqm_min, u.unit.price_from_qar, round(u.ppsqm), u.band == null ? '' : bandName(u.band), round(u.stats?.median), round(u.premium, 4), u.fallback ? 'yes' : '']) },
    { name: 'Payment terms', headers: ['Project', 'Developer', 'Handover', 'Down %', 'Paid by handover %', 'After handover %', 'Years after handover', 'PV discount vs list'],
      rows: plans.map(({ p, s }) => [p.name_en, p.developer, p.handover, round(s.down, 4), round(s.byHandover, 4), round(s.after, 4), s.after ? s.yearsAfter : '', round(s.pvDiscount, 4)]) },
  ]));
}
