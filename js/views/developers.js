import { t, L, nf, pct, dateFmt } from '../i18n.js';
import { chart, esc, calcPanel, kpi, premSpan, exportBtn } from '../ui.js';
import { projectPremium, quantile } from '../calc/pricing.js';
import { planSummary } from './focus.js';
import { handoverSlips } from './projects.js';
import { exportSheets, round } from '../export.js';

const med = (v) => quantile(v.filter((x) => x != null).sort((a, b) => a - b), 0.5);

export function developerRows(data) {
  const by = {};
  for (const p of data.projects) if (p.developer && !/^Not stated/.test(p.developer)) (by[p.developer] ||= []).push(p);
  return Object.entries(by).map(([dev, ps]) => {
    const pipeline = ps.filter((p) => p.status !== 'completed');
    const plans = ps.map(planSummary).filter(Boolean);
    const slips = ps.map((p) => handoverSlips(data, p.id));
    const note = data.devNotes[dev] || {};
    return {
      dev, ps, pipeline: pipeline.length, delivered: ps.length - pipeline.length,
      units: pipeline.reduce((s, p) => s + (p.units_total || 0), 0), unitsKnown: pipeline.filter((p) => p.units_total).length,
      premium: med(ps.map((p) => projectPremium(data, p)?.premium)),
      down: med(plans.map((x) => x.down)), byHandover: med(plans.map((x) => x.byHandover)), after: med(plans.map((x) => x.after)),
      slips: slips.reduce((s, x) => s + x.slips, 0), slipMonths: slips.reduce((s, x) => s + x.months, 0),
      onTime: note.delivered_on_time || '', late: note.delivered_late || '', delay: note.avg_delay_months || '', notes: note.notes || '', noteSource: note.source || '',
      areas: [...new Set(ps.map((p) => L(data.areaById[p.area_id])))].join(', '),
      taameer: ps.some((p) => p.taameer),
    };
  }).sort((a, b) => b.ps.length - a.ps.length || a.dev.localeCompare(b.dev));
}

export function renderDevelopers(el, data) {
  const rows = developerRows(data);
  const top = rows.slice(0, 12);
  el.innerHTML = `
    <div class="page-head"><div><h1>${t('dev.title')}</h1><p class="muted">${t('dev.lede')}</p></div><div class="page-actions">${exportBtn()}</div></div>
    <div class="grid g-kpi">
      ${kpi(t('dev.count'), nf(rows.length), t('dev.countSub', { n: data.projects.length }))}
      ${kpi(t('dev.slips'), nf(rows.reduce((s, r) => s + r.slips, 0)), t('dev.slipsSub', { d: dateFmt(data.history?.first), n: data.history?.snapshots || 1 }))}
      ${kpi(t('dev.manual'), nf(rows.filter((r) => r.onTime || r.late).length), t('dev.manualSub'))}
    </div>
    <div class="card section">
      <div class="card-head"><h2>${t('dev.chart')}</h2></div>
      <div class="chart-box tall"><canvas id="cDev"></canvas></div>
    </div>
    <div class="card section table-wrap">
      <table><thead><tr><th>${t('col.developer')}</th><th class="num">${t('group.pipeline')}</th><th class="num">${t('group.delivered')}</th><th class="num">${t('dev.units')}</th>
        <th class="num">${t('col.premium')}</th><th class="num">${t('plan.down')}</th><th class="num">${t('plan.byHandover')}</th><th class="num">${t('plan.after')}</th>
        <th class="num">${t('dev.slipCol')}</th><th class="num">${t('dev.onTime')}</th><th class="num">${t('dev.late')}</th><th>${t('dev.notes')}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.taameer ? 'taameer' : ''}"><td><a href="#/projects?group=all" data-dev="${esc(r.dev)}">${esc(r.dev)}</a><div class="mini">${esc(r.areas)}</div></td>
        <td class="num">${nf(r.pipeline)}</td><td class="num">${nf(r.delivered)}</td><td class="num">${r.units ? nf(r.units) : '—'}${r.pipeline ? ` <span class="mini">(${r.unitsKnown}/${r.pipeline})</span>` : ''}</td>
        <td class="num">${premSpan(r.premium)}</td><td class="num">${pct(r.down, 0)}</td><td class="num">${pct(r.byHandover, 0)}</td><td class="num">${pct(r.after, 0)}</td>
        <td class="num">${r.slips ? `<span class="delta down">${r.slips} · ${t('dev.months', { m: r.slipMonths })}</span>` : '0'}</td>
        <td class="num">${esc(r.onTime) || '—'}</td><td class="num">${esc(r.late) || '—'}</td><td class="small">${esc(r.notes)}${r.noteSource ? ` <span class="mini">(${esc(r.noteSource)})</span>` : ''}</td></tr>`).join('')}</tbody></table>
      <p class="small muted">${t('dev.note')} ${t('dev.brokerNote', { n: data.projects.filter((p) => /^Not stated/.test(p.developer || '')).length })}</p>
      ${calcPanel(t('calc.how'), `<p>${t('calc.devBody')}</p>`)}
    </div>`;

  chart(el.querySelector('#cDev'), {
    labels: top.map((r) => r.dev), stacked: true,
    datasets: [{ label: t('group.pipeline'), data: top.map((r) => r.pipeline) }, { label: t('group.delivered'), data: top.map((r) => r.delivered) }],
    yFormat: (v) => nf(v),
  });
  el.querySelectorAll('[data-dev]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = '#/projects?group=all';
    setTimeout(() => { const s = document.querySelector('#dev'); if (s) { s.value = a.dataset.dev; s.dispatchEvent(new Event('input')); } }, 0);
  }));
  el.querySelector('#exportBtn').addEventListener('click', () => exportSheets('developers', [{
    name: 'Developers',
    headers: ['Developer', 'Areas', 'Pipeline projects', 'Delivered projects', 'Pipeline units (published)', 'Projects with unit counts', 'Median premium', 'Median down payment', 'Median paid by handover',
      'Median after handover', 'Handover slips tracked', 'Slip months', 'Delivered on time (manual)', 'Delivered late (manual)', 'Avg delay months (manual)', 'Notes', 'Source'],
    rows: rows.map((r) => [r.dev, r.areas, r.pipeline, r.delivered, r.units, r.unitsKnown, round(r.premium, 4), round(r.down, 4), round(r.byHandover, 4), round(r.after, 4), r.slips, r.slipMonths, r.onTime, r.late, r.delay, r.notes, r.noteSource]),
  }]));
}
