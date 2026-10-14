import { t, L, dateFmt, signedPct } from './i18n.js';
import { isWatched } from './watch.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function regimeBadge(regime) {
  return `<span class="badge ${esc(regime)}">${esc(t(`regime.${regime}`))}</span>`;
}

export function confBadge(conf) {
  if (!conf || conf === 'high') return '';
  return `<span class="badge ${conf === 'low' ? 'warn' : ''}" title="${esc(t('conf.tip'))}">${esc(t(`conf.${conf}`))}</span>`;
}

// Source line shown under any figure in Analyst mode.
export function sourceNote(rec) {
  if (!rec) return '';
  const link = rec.source_url ? `<a href="${esc(rec.source_url)}" target="_blank" rel="noopener">${esc(rec.source)}</a>` : esc(rec.source || '—');
  return `<div class="analyst-only small muted">${t('src.label')}: ${link} · ${t('src.asof')} ${dateFmt(rec.as_of)} ${confBadge(rec.confidence)}</div>`;
}

export function calcPanel(title, bodyHtml) {
  return `<div class="analyst-only calc-panel"><h4>${esc(title)}</h4>${bodyHtml}</div>`;
}

export function tableView(headers, rows) {
  return `<details class="tableview"><summary>${t('chart.table')}</summary><div class="table-wrap"><table>
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

export function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const charts = new Set();
export function destroyCharts() { charts.forEach((c) => c.destroy()); charts.clear(); }

// Single-axis Chart.js with Taameer styling; thin bars, rounded data-ends, hover tooltips.
export function chart(canvas, { type = 'bar', labels, datasets, yFormat = (v) => v, stacked = false }) {
  const ink2 = css('--ink-2'), line = css('--line');
  const c = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        borderWidth: type === 'line' ? 2 : 0,
        borderRadius: type === 'bar' ? 4 : 0,
        maxBarThickness: 28,
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.25,
        backgroundColor: d.color || css(`--series-${i + 1}`),
        borderColor: d.color || css(`--series-${i + 1}`),
        ...d,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, labels: { color: ink2, boxWidth: 10, boxHeight: 10 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${yFormat(ctx.parsed.y)}` } },
      },
      scales: {
        x: { stacked, grid: { display: false }, ticks: { color: ink2, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, border: { color: line } },
        y: { stacked, beginAtZero: type === 'bar', grid: { color: line }, ticks: { color: ink2, callback: yFormat }, border: { display: false } },
      },
    },
  });
  charts.add(c);
  return c;
}

let maps = [];
export function destroyMaps() { maps.forEach((m) => m.remove()); maps = []; }

export function makeMap(el, center = [25.32, 51.5], zoom = 11) {
  const m = L_.map(el, { scrollWheelZoom: false }).setView(center, zoom);
  L_.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
  }).addTo(m);
  maps.push(m);
  return m;
}
// Leaflet's global is `L`, which clashes with our L() helper name in modules.
const L_ = window.L;
export { L_ as Leaflet };

export function nameOf(rec) { return esc(L(rec)); }

// ---------- v2 helpers ----------
// Handover stated by 3+ brokers that differs from the published date (listing descriptions).
export function handoverAlt(p, data) {
  const facts = p.listing_facts || (p.listing_id && data?.projectById?.[p.listing_id]?.listing_facts) || {};
  const f = facts.handover;
  if (!f || f.brokers < 3 || !p.handover || f.value === p.handover) return null;
  return { value: f.value, brokers: f.brokers, disagreeing: f.disagreeing_brokers };
}
export function handoverCell(p, data) {
  const alt = handoverAlt(p, data);
  return `${esc(p.handover || '—')}${alt ? `<div class="mini" style="color:var(--warn)" title="${esc(t('handover.altTip'))}">⚠ ${esc(t('handover.alt', { d: alt.value, n: alt.brokers }))}</div>` : ''}`;
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function kpi(label, value, sub = '', cls = '') {
  return `<div class="card kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub || ''}</div></div>`;
}

// Premium vs comparables: orange above, blue below (Taameer: no red/green except change indicators).
export function premSpan(x) {
  if (x == null || Number.isNaN(x)) return '—';
  return `<span class="prem ${x > 0.005 ? 'pos' : x < -0.005 ? 'neg' : ''}">${signedPct(x)}</span>`;
}
// Change over time: green up, red down.
export function deltaSpan(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return '—';
  return `<span class="delta ${x > 0.0005 ? 'up' : x < -0.0005 ? 'down' : ''}">${x > 0.0005 ? '▲' : x < -0.0005 ? '▼' : ''} ${signedPct(x, digits)}</span>`;
}

export function qualityBadge(p) {
  const q = p.location_quality || 'building';
  if (q === 'building') return '';
  return `<span class="badge q ${q === 'generic' ? 'warn' : ''}" title="${esc(t(`loc.${q}Tip`))}">${esc(t(`loc.${q}`))}</span>`;
}

export function starBtn(id) {
  const on = isWatched(id);
  return `<button class="star ${on ? 'on' : ''}" data-star="${esc(id)}" aria-pressed="${on}" title="${esc(t('watch.toggle'))}" aria-label="${esc(t('watch.toggle'))}">${on ? '★' : '☆'}</button>`;
}

export function exportBtn(id = 'exportBtn') {
  return `<button id="${id}" class="btn secondary" type="button">⤓ ${esc(t('action.export'))}</button>`;
}

// Bars + line on a second axis (e.g. monthly sales and median price).
export function comboChart(canvas, { labels, bars, line, yFormat = (v) => v, y2Format = (v) => v }) {
  const ink2 = css('--ink-2'), lineC = css('--line');
  const c = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: bars.label, data: bars.data, backgroundColor: css('--series-1'), borderRadius: 4, maxBarThickness: 28, yAxisID: 'y', order: 2 },
        { type: 'line', label: line.label, data: line.data, borderColor: css('--series-2'), backgroundColor: css('--series-2'), borderWidth: 2, pointRadius: 2, tension: 0.25, yAxisID: 'y2', spanGaps: true, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: ink2, boxWidth: 10, boxHeight: 10 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.dataset.yAxisID === 'y2' ? y2Format(ctx.parsed.y) : yFormat(ctx.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink2, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, border: { color: lineC } },
        y: { beginAtZero: true, grid: { color: lineC }, ticks: { color: ink2, callback: yFormat }, border: { display: false } },
        y2: { position: 'right', grid: { display: false }, ticks: { color: ink2, callback: y2Format }, border: { display: false } },
      },
    },
  });
  charts.add(c);
  return c;
}

// Scatter with labelled points; datasets: [{label, color, points:[{x,y,label,href}]}].
export function scatterChart(canvas, { datasets, xFormat = (v) => v, yFormat = (v) => v, xTitle = '', yTitle = '', xTime = false, onClick }) {
  const ink2 = css('--ink-2'), lineC = css('--line');
  const c = new Chart(canvas, {
    type: 'scatter',
    data: { datasets: datasets.map((d) => ({ label: d.label, data: d.points, backgroundColor: d.color, borderColor: d.border || css('--surface'), borderWidth: 1.5, pointRadius: d.radius || 6, pointHoverRadius: (d.radius || 6) + 2, pointStyle: d.style || 'circle', ...(d.extra || {}) })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: ink2, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.raw.label || ctx.dataset.label}: ${xFormat(ctx.parsed.x)} · ${yFormat(ctx.parsed.y)}` } },
      },
      scales: {
        x: { grid: { color: lineC }, ticks: { color: ink2, callback: xFormat, maxTicksLimit: 8 }, title: { display: !!xTitle, text: xTitle, color: ink2 }, border: { color: lineC } },
        y: { grid: { color: lineC }, ticks: { color: ink2, callback: yFormat }, title: { display: !!yTitle, text: yTitle, color: ink2 }, border: { display: false } },
      },
      onClick: onClick ? (e, els) => { if (els[0]) onClick(c.data.datasets[els[0].datasetIndex].data[els[0].index]); } : undefined,
      onHover: onClick ? (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } : undefined,
    },
  });
  charts.add(c);
  return c;
}
