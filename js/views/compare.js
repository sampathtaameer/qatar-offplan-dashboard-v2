import { t, L, nf, qar, pct, km } from '../i18n.js';
import { esc, regimeBadge, premSpan, deltaSpan, qualityBadge, exportBtn, toast, handoverCell } from '../ui.js';
import { statsForArea, pricePosition, projectPricePerSqm, unitYields, projectPremium, unitYieldsNet, fromPrice } from '../calc/pricing.js';
import { getAssumptions } from '../settings.js';
import { planSummary } from './focus.js';
import { priceChange } from './projects.js';
import { exportSheets, round } from '../export.js';
import { livability } from '../calc/livability.js';
import { noiseProfile } from '../calc/noise.js';
import { facadeSunAllSeasons, ORIENTATIONS, heatRating } from '../calc/sun.js';
import { getCompare, setCompare, bandLabel } from './projects.js';

export function renderCompare(el, data, query = '') {
  const fromUrl = new URLSearchParams(query).get('ids');
  let ids = (fromUrl ? fromUrl.split(',') : getCompare()).filter((id) => data.projectById[id]).slice(0, 4);
  if (fromUrl) setCompare(ids);

  const projects = ids.map((id) => data.projectById[id]);
  const rows = projects.map((p) => metrics(p, data));

  el.innerHTML = `
    <div class="page-head"><div><h1>${t('compare.title')}</h1><p class="muted">${t('compare.lede')}</p></div>
      <div class="page-actions">${ids.length ? `<button id="share" class="btn secondary">${t('compare.share')}</button>${exportBtn()}` : ''}</div></div>
    <div class="filters">
      <label class="field">${t('compare.addLabel')}<select id="add"><option value="">—</option>
        ${data.projects.filter((p) => !ids.includes(p.id)).map((p) => `<option value="${p.id}">${esc(L(p))}</option>`).join('')}</select></label>
      <div class="chips">${projects.map((p) => `<span class="chip">${esc(L(p))}<button data-rm="${p.id}" aria-label="${t('compare.remove')}">×</button></span>`).join('')}</div>
    </div>
    ${ids.length < 2 ? `<div class="card empty">${t('compare.empty')}</div>` : `
    <div class="card table-wrap"><table class="compare-table">
      <thead><tr><th></th>${projects.map((p) => `<th><a href="#/project/${p.id}">${esc(L(p))}</a></th>`).join('')}</tr></thead>
      <tbody>
        ${row(t('col.area'), rows.map((r) => `${esc(L(r.area))}<br>${regimeBadge(r.area.regime)}`))}
        ${row(t('col.developer'), rows.map((r) => esc(r.p.developer)))}
        ${row(t('col.handover'), rows.map((r) => handoverCell(r.p, data)))}
        ${row(t('col.status'), rows.map((r) => t(`status.${r.p.status}`)))}
        ${row(t('col.units'), rows.map((r) => nf(r.p.units_total)))}
        ${row(t('col.fromPrice'), rows.map((r) => `${qar(r.from)}${r.chg != null ? `<br>${deltaSpan(r.chg)}` : ''}`))}
        ${row(t('col.priceSqm'), rows.map((r) => qar(r.ppsqm)))}
        ${row(t('col.premium'), rows.map((r) => premSpan(r.prem)))}
        ${row(t('col.vsArea'), rows.map((r) => (r.pos ? `${bandLabel(r.pos.band)} ${pct(r.pos.vsMedian)}` : '—')))}
        ${row(t('compare.bestYield'), rows.map((r) => (r.bestYield ? `${pct(r.bestYield.yield)} (${t(`utype.${r.bestYield.type}`)})` : '—')))}
        ${row(t('col.bestNet'), rows.map((r) => (r.bestNet ? `${pct(r.bestNet.net)} (${t(`utype.${r.bestNet.type}`)})` : '—')))}
        ${row(t('plan.down'), rows.map((r) => pct(r.plan?.down, 0)))}
        ${row(t('plan.byHandover'), rows.map((r) => pct(r.plan?.byHandover, 0)))}
        ${row(t('plan.after'), rows.map((r) => (r.plan?.after ? `${pct(r.plan.after, 0)} · ${t('plan.yrs', { n: r.plan.yearsAfter })}` : pct(r.plan?.after, 0))))}
        ${row(t('plan.pvDiscount'), rows.map((r) => pct(r.plan?.pvDiscount, 1)))}
        ${row(t('liv.title'), rows.map((r) => (r.liv.total == null ? '—' : `${nf(r.liv.total)}/100`)))}
        ${row(t('poi.metro'), rows.map((r) => km(r.liv.parts.find((x) => x.type === 'metro')?.distanceM)))}
        ${row(t('poi.beach'), rows.map((r) => km(r.liv.parts.find((x) => x.type === 'beach')?.distanceM)))}
        ${row(t('noise.air'), rows.map((r) => t(`noise.${r.noise.airLevel}`)))}
        ${row(t('noise.road'), rows.map((r) => t(`noise.${r.noise.roadLevel}`)))}
        ${row(t('compare.sunS2'), rows.map((r) => `${nf(r.sun.summer.afternoonHours, { maximumFractionDigits: 1 })} ${t('unit.h')} · ${t(`heat.${heatRating(r.sun.summer.afternoonHours)}`)}<div class="mini">${t(`dir.${r.facade}`)} · ${t('sun.floor')} ${r.floor}</div>`))}
        ${row(t('loc.title'), rows.map((r) => qualityBadge(r.p) || t('loc.building')))}
        ${row(t('views.title'), rows.map((r) => (r.p.views || []).map((v) => t(`view.${v}`)).join(', ') || '—'))}
      </tbody></table></div>
    <p class="small muted">${t('compare.note')}</p>`}`;

  el.querySelector('#add').addEventListener('change', (e) => {
    if (!e.target.value) return;
    if (ids.length >= 4) { toast(t('compare.max')); e.target.value = ''; return; }
    location.hash = `#/compare?ids=${[...ids, e.target.value].join(',')}`;
  });
  el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    const next = ids.filter((x) => x !== b.dataset.rm);
    setCompare(next);
    location.hash = `#/compare?ids=${next.join(',')}`;
  }));
  el.querySelector('#share')?.addEventListener('click', async (e) => {
    const url = `${location.origin}${location.pathname}#/compare?ids=${ids.join(',')}`;
    try { await navigator.clipboard.writeText(url); toast(t('compare.copied')); } catch { toast(url); }
  });
  el.querySelector('#exportBtn')?.addEventListener('click', () => exportSheets('compare', [{
    name: 'Compare',
    headers: ['Metric', ...projects.map((p) => p.name_en)],
    rows: [
      ['Developer', ...rows.map((r) => r.p.developer)], ['Area', ...rows.map((r) => r.area.name_en)], ['Handover', ...rows.map((r) => r.p.handover)],
      ['Status', ...rows.map((r) => r.p.status)], ['Units', ...rows.map((r) => r.p.units_total)], ['From price QAR', ...rows.map((r) => r.from)],
      ['Avg QAR/sqm', ...rows.map((r) => round(r.ppsqm))], ['Premium vs like-for-like', ...rows.map((r) => round(r.prem, 4))],
      ['Best gross yield', ...rows.map((r) => round(r.bestYield?.yield, 4))], ['Best net yield', ...rows.map((r) => round(r.bestNet?.net, 4))],
      ['Down payment', ...rows.map((r) => round(r.plan?.down, 4))], ['Paid by handover', ...rows.map((r) => round(r.plan?.byHandover, 4))],
      ['After handover', ...rows.map((r) => round(r.plan?.after, 4))], ['PV discount vs list', ...rows.map((r) => round(r.plan?.pvDiscount, 4))],
      ['Livability /100', ...rows.map((r) => round(r.liv.total))], ['Aircraft noise', ...rows.map((r) => r.noise.airLevel)], ['Road noise', ...rows.map((r) => r.noise.roadLevel)],
      ['Summer afternoon sun h', ...rows.map((r) => round(r.sun.summer.afternoonHours, 1))], ['Location quality', ...rows.map((r) => r.p.location_quality)],
    ],
  }]));
}

function metrics(p, data) {
  const area = data.areaById[p.area_id] || {};
  const a = getAssumptions();
  // Each project's own facade (if known) and a mid-height floor, not one fixed setting for all.
  const facade = p.default_facade || 'S';
  const floor = p.floors ? Math.max(1, Math.round(p.floors / 2)) : 10;
  const ppsqm = projectPricePerSqm(p);
  const from = Math.min(...(p.unit_mix || []).map((u) => u.price_from_qar).filter(Boolean));
  const yields = unitYields(p, data.rentsFor(p.area_id)).filter((y) => y.yield != null);
  return {
    p, area, ppsqm,
    from: Number.isFinite(from) ? from : null,
    pos: pricePosition(ppsqm, statsForArea(data, p.area_id)),
    bestYield: yields.sort((a, b) => b.yield - a.yield)[0] || null,
    liv: livability(p, data.poi),
    noise: noiseProfile(p, data.noise),
    sun: facadeSunAllSeasons({ lat: p.lat, lng: p.lng, facadeDeg: ORIENTATIONS[facade], floor, density: area.density || 'medium' }),
    facade, floor,
    prem: projectPremium(data, p)?.premium ?? null,
    bestNet: unitYieldsNet(p, data.rentsFor(p.area_id), a).filter((y) => y.net != null).sort((x, z) => z.net - x.net)[0] || null,
    plan: planSummary(p),
    chg: priceChange(data, p.id),
  };
}

function row(label, cells) {
  return `<tr><th scope="row">${label}</th>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
}
