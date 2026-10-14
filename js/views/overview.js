import { t, L, nf, qarShort, qar, dateFmt, monthFmt, pct } from '../i18n.js';
import { chart, comboChart, makeMap, Leaflet, esc, css, tableView, calcPanel, kpi, deltaSpan, premSpan } from '../ui.js';
import { monthlyMedians, projectPremium, quantile, fromPrice } from '../calc/pricing.js';

export function weeklyTotals(tx, weeks = 52) {
  const byWeek = {};
  for (const r of tx) {
    const w = (byWeek[r.week] ||= { week: r.week, count: 0, value: 0 });
    w.count += r.count || 0;
    w.value += r.value_qar || 0;
  }
  return Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week)).slice(-weeks);
}

export const FOREIGN = new Set(['freehold', 'usufruct']);

// Apartment sales in freehold and usufruct areas, by calendar month (complete months only).
export function marketPulse(data) {
  const foreign = new Set(data.areas.filter((a) => FOREIGN.has(a.regime)).map((a) => a.id));
  const tx = data.transactions.filter((r) => r.property_type === 'unit' && foreign.has(r.area_id));
  const allWeeks = [...new Set(data.transactions.map((r) => r.week))].sort();
  const latestWeek = allWeeks[allWeeks.length - 1];
  const next = new Date(`${latestWeek}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 7);
  const firstOpenMonth = next.toISOString().slice(0, 7); // months before this are complete
  const months = {};
  for (const r of tx) {
    const m = r.week.slice(0, 7);
    if (m >= firstOpenMonth) continue;
    const x = (months[m] ||= { month: m, count: 0, value: 0 });
    x.count += r.count; x.value += r.value_qar;
  }
  const deals = data.deals.filter((d) => foreign.has(d.area_id) && d.date.slice(0, 7) < firstOpenMonth);
  const med = Object.fromEntries(monthlyMedians(deals).map((m) => [m.month, m]));
  const list = Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, median: med[m.month]?.median ?? null, n: med[m.month]?.n ?? 0 }));
  const last = list[list.length - 1];
  const prev = list[list.length - 2];
  const yearAgo = last && list.find((m) => m.month === `${Number(last.month.slice(0, 4)) - 1}${last.month.slice(4)}`);
  // Median price: last 3 complete months vs the same 3 months a year earlier (smooths thin months).
  const window = (endMonth) => {
    const end = new Date(`${endMonth}-01T00:00:00Z`);
    const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - 2);
    const s = start.toISOString().slice(0, 7);
    const v = deals.filter((d) => d.sqm >= 25 && d.date.slice(0, 7) >= s && d.date.slice(0, 7) <= endMonth).map((d) => d.ppsqm).sort((a, b) => a - b);
    return { median: quantile(v, 0.5), n: v.length, from: s, to: endMonth };
  };
  const p3 = last ? window(last.month) : null;
  const p3ya = last ? window(`${Number(last.month.slice(0, 4)) - 1}${last.month.slice(4)}`) : null;
  const ch = (a, b) => (a && b ? a / b - 1 : null);
  return {
    list, last, prev, yearAgo, p3, p3ya, latestWeek,
    mom: { count: ch(last?.count, prev?.count), value: ch(last?.value, prev?.value) },
    yoy: { count: ch(last?.count, yearAgo?.count), value: ch(last?.value, yearAgo?.value), median: ch(p3?.median, p3ya?.median) },
  };
}

export function supplyByYear(data) {
  const pipeline = data.projects.filter((p) => p.status !== 'completed');
  const years = {};
  for (const p of pipeline) {
    const y = Number(String(p.handover || '').slice(0, 4)) || 'unknown';
    const r = (years[y] ||= { year: y, units: 0, known: 0, unknown: 0 });
    if (p.units_total) { r.units += p.units_total; r.known++; } else r.unknown++;
  }
  for (const e of data.raw.pipeline.records) {
    const r = (years[e.year] ||= { year: e.year, units: 0, known: 0, unknown: 0 });
    r.units += e.units; r.external = (r.external || 0) + e.units;
  }
  return Object.values(years).sort((a, b) => String(a.year).localeCompare(String(b.year)));
}

export const premColor = (x) => (x == null ? css('--surface-2') : x > 0.15 ? css('--div-pos') : x < -0.05 ? css('--div-neg') : css('--div-mid'));

export function renderOverview(el, data) {
  const pulse = marketPulse(data);
  const supply = supplyByYear(data);
  const weeks = weeklyTotals(data.transactions);
  const year = new Date().getFullYear();
  const pipeline = data.projects.filter((p) => p.status !== 'completed');
  const delivered = data.projects.length - pipeline.length;
  const next3 = supply.filter((s) => s.year >= year && s.year <= year + 2);
  const units3 = next3.reduce((s, x) => s + x.units, 0);
  const known = pipeline.filter((p) => p.units_total).length;
  const prem = pipeline.map((p) => ({ p, pr: projectPremium(data, p) })).filter((x) => x.pr);
  const premMedian = quantile(prem.map((x) => x.pr.premium).sort((a, b) => a - b), 0.5);
  const months = pulse.list.slice(-21);
  const L_ = pulse.last;

  el.innerHTML = `
    <div class="page-head"><div><h1>${t('overview.title')}</h1><p class="muted">${t('overview.lede')}</p></div></div>
    <h2>${t('pulse.title')}</h2>
    <p class="small muted">${t('pulse.sub', { m: monthFmt(L_?.month) })}</p>
    <div class="grid g-kpi">
      ${kpi(t('pulse.sales'), L_ ? nf(L_.count) : '—', `${t('pulse.mom')} ${deltaSpan(pulse.mom.count)} · ${t('pulse.yoy')} ${deltaSpan(pulse.yoy.count)}`)}
      ${kpi(t('pulse.value'), L_ ? qarShort(L_.value) : '—', `${t('pulse.mom')} ${deltaSpan(pulse.mom.value)} · ${t('pulse.yoy')} ${deltaSpan(pulse.yoy.value)}`)}
      ${kpi(t('pulse.median'), pulse.p3?.median ? qar(pulse.p3.median) : '—', `${t('pulse.3m')} · ${t('pulse.yoy')} ${deltaSpan(pulse.yoy.median)}`)}
      ${kpi(t('kpi.premium'), premSpan(premMedian), t('kpi.premiumSub', { n: prem.length }), 'accent')}
      ${kpi(t('kpi.pipeline'), nf(units3), t('kpi.pipelineSub2', { from: year, to: year + 2, k: known, n: pipeline.length }))}
      ${kpi(t('kpi.projects'), nf(pipeline.length), t('kpi.projectsSub3', { dv: pipeline.filter((p) => p.source_kind !== 'broker').length, br: pipeline.filter((p) => p.source_kind === 'broker').length, d: delivered }))}
    </div>
    ${calcPanel(t('calc.how'), `<p>${t('calc.pulseBody')}</p>${pulse.p3 ? `<p><code>${t('calc.pulseWindow', { a: pulse.p3.from, b: pulse.p3.to, n: pulse.p3.n, c: pulse.p3ya?.from, d: pulse.p3ya?.to, m: pulse.p3ya?.n })}</code></p>` : ''}`)}

    <div class="grid g-2 section">
      <div class="card">
        <div class="card-head"><h2>${t('pulse.chart')}</h2><span class="small muted">${t('src.moj')}</span></div>
        <div class="chart-box tall"><canvas id="cPulse"></canvas></div>
        ${tableView([t('col.month'), t('pulse.sales'), t('col.value'), t('col.medianSqm')], months.map((m) => [m.month, nf(m.count), qar(m.value), m.n >= 3 ? nf(m.median) : '—']))}
      </div>
      <div class="card">
        <div class="card-head"><h2>${t('supply.chart')}</h2><a class="small" href="#/projects">${t('nav.projects')} →</a></div>
        <div class="chart-box tall"><canvas id="cSupply"></canvas></div>
        <p class="small muted">${t('supply.note', { k: known, n: pipeline.length })}</p>
        ${tableView([t('col.year'), t('col.units'), t('supply.known'), t('supply.unknown')], supply.map((s) => [s.year === 'unknown' ? t('supply.noDate') : s.year, nf(s.units), nf(s.known), nf(s.unknown)]))}
      </div>
    </div>

    <div class="card section">
      <div class="card-head"><h2>${t('premMap.title')}</h2><span class="small muted">${t('premMap.sub')}</span></div>
      <div id="map" class="map"></div>
      <div class="legend">
        <span><i style="background:var(--div-neg)"></i>${t('premMap.below')}</span>
        <span><i style="background:var(--div-mid)"></i>${t('premMap.mid')}</span>
        <span><i style="background:var(--div-pos)"></i>${t('premMap.above')}</span>
        <span><i style="background:var(--surface-2);border:1px solid var(--line)"></i>${t('premMap.none')}</span>
        <span>◆ ${t('premMap.taameer')}</span>
      </div>
      ${calcPanel(t('calc.how'), `<p>${t('calc.premiumBody')}</p>`)}
    </div>

    <div class="grid g-2 section">
      <div class="card">
        <div class="card-head"><h2>${t('overview.valueChart')}</h2><span class="small muted">${t('kpi.allTypes')}</span></div>
        <div class="chart-box"><canvas id="cValue"></canvas></div>
        ${tableView([t('col.week'), t('col.deals'), t('col.value')], weeks.map((w) => [w.week, nf(w.count), qar(w.value)]))}
      </div>
      <div class="card">
        <div class="card-head"><h2>${t('overview.changes')}</h2><a class="small" href="data/digest.html" target="_blank" rel="noopener">${t('changes.digest')} →</a></div>
        ${data.changes.length ? `<ul class="changes">${data.changes.slice(0, 2).map((c) => `<li><strong>${dateFmt(c.date)}</strong><ul>${c.items.slice(0, 6).map((i) => `<li>${esc(L(i, 'text'))}</li>`).join('')}</ul></li>`).join('')}</ul>` : `<p class="muted">${t('overview.noChanges')}</p>`}
      </div>
    </div>`;

  comboChart(el.querySelector('#cPulse'), {
    labels: months.map((m) => monthFmt(m.month)),
    bars: { label: t('pulse.sales'), data: months.map((m) => m.count) },
    line: { label: t('col.medianSqm'), data: months.map((m) => (m.n >= 3 ? m.median : null)) },
    yFormat: (v) => nf(v), y2Format: (v) => nf(v),
  });
  const sy = supply.filter((s) => s.year !== 'unknown');
  chart(el.querySelector('#cSupply'), { labels: sy.map((s) => s.year), datasets: [{ label: t('col.units'), data: sy.map((s) => s.units) }], yFormat: (v) => nf(v) });
  chart(el.querySelector('#cValue'), { labels: weeks.map((w) => dateFmt(w.week)), datasets: [{ label: t('col.value'), data: weeks.map((w) => w.value) }], yFormat: (v) => qarShort(v) });

  const map = makeMap(el.querySelector('#map'), [25.36, 51.5], 11);
  const premById = Object.fromEntries(prem.map((x) => [x.p.id, x.pr.premium]));
  const pts = data.projects.filter((p) => p.lat != null).map((p) => [p.lat, p.lng]);
  if (pts.length) map.fitBounds(pts, { padding: [24, 24], maxZoom: 13 });
  const seen = {};
  for (const p of data.projects) {
    if (p.lat == null) continue;
    // Several listings share a district point; fan them out slightly so each stays clickable.
    const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    const k = (seen[key] = (seen[key] || 0) + 1) - 1;
    const ang = k * 2.4, rr = k ? 0.0011 * Math.sqrt(k) : 0;
    const ll = [p.lat + rr * Math.sin(ang), p.lng + rr * Math.cos(ang)];
    const pr = premById[p.id];
    const popup = `<strong>${esc(L(p))}</strong><br>${esc(p.developer)}<br>${t('col.premium')}: ${pr == null ? '—' : pct(pr)}<br>${t('col.fromPrice')}: ${qar(fromPrice(p))}<br><a href="#/project/${p.id}">${t('action.open')}</a>`;
    const opts = { radius: p.status === 'completed' || p.source_kind === 'broker' ? 6 : 9, weight: 2, color: css('--surface'), fillColor: premColor(pr), fillOpacity: p.status === 'completed' ? 0.55 : 0.95 };
    if (p.taameer) {
      Leaflet.marker(ll, { icon: Leaflet.divIcon({ className: '', html: `<div style="width:16px;height:16px;transform:rotate(45deg);background:${premColor(pr)};border:2px solid ${css('--navy')}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }) }).bindPopup(popup).addTo(map);
    } else Leaflet.circleMarker(ll, opts).bindPopup(popup).addTo(map);
  }
}
