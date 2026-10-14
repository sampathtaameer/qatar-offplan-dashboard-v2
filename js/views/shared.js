import { t, L, nf, km, pct } from '../i18n.js';
import { esc, calcPanel, makeMap, Leaflet, css } from '../ui.js';
import { livability, CATEGORIES } from '../calc/livability.js';
import { noiseProfile } from '../calc/noise.js';
import { mapsLink, directionsLink } from '../calc/geo.js';

export function livabilityCard(p, data) {
  const lv = livability(p, data.poi);
  return `<div class="card">
    <div class="card-head"><h2>${t('liv.title')}</h2><span class="kpi"><span class="value">${lv.total == null ? '—' : nf(lv.total)}</span><span class="muted">/100</span></span></div>
    ${lv.parts.map((x) => `<div class="score-row">
        <div>${t(`poi.${x.type}`)}<div class="small muted">${x.nearest ? `${esc(L(x.nearest))} · ${km(x.distanceM)}` : t('liv.none')}
          ${x.nearest ? ` · <a href="${directionsLink(p, x.nearest)}" target="_blank" rel="noopener">${t('action.directions')}</a>` : ''}</div></div>
        <div class="meter" role="img" aria-label="${nf(x.score)}/100"><span style="width:${x.score ?? 0}%"></span></div>
        <div class="num">${x.score == null ? '—' : nf(x.score)}</div></div>`).join('')}
    ${calcPanel(t('calc.how'), `<p>${t('calc.livBody')}</p><table><tr><th>${t('col.category')}</th><th class="num">${t('col.weight')}</th><th class="num">100 ≤</th><th class="num">0 ≥</th></tr>
      ${Object.entries(CATEGORIES).map(([k, c]) => `<tr><td>${t(`poi.${k}`)}</td><td class="num">${c.weight}</td><td class="num">${km(c.good)}</td><td class="num">${km(c.poor)}</td></tr>`).join('')}</table>`)}
  </div>`;
}

export function noiseCard(p, data) {
  const n = noiseProfile(p, data.noise);
  const lvl = (l) => `<span class="badge ${l === 'high' ? 'bad' : l === 'moderate' ? 'warn' : 'good'}">${t(`noise.${l}`)}</span>`;
  return `<div class="card">
    <h2>${t('noise.title')}</h2>
    <div class="score-row"><div>${t('noise.air')}<div class="small muted">${n.air.runway ? t('noise.airDetail', { rw: esc(n.air.runway), d: km(n.air.alongM), lat: km(n.air.lateralM) }) : t('noise.outside')}</div></div><div></div><div>${lvl(n.airLevel)}</div></div>
    <div class="score-row"><div>${t('noise.road')}<div class="small muted">${n.road.road ? `${esc(n.road.road)} · ${km(n.road.distanceM)}` : '—'}</div></div><div></div><div>${lvl(n.roadLevel)}</div></div>
    <p class="small muted">${t('noise.caveat')}</p>
    ${calcPanel(t('calc.how'), `<p>${t('calc.noiseBody')}</p><p>${t('calc.score')}: ${t('noise.air')} ${pct(n.air.score, 0)}, ${t('noise.road')} ${pct(n.road.score, 0)}</p>`)}
  </div>`;
}

// Map with the subject point, nearby POIs and runway corridors.
export function locationMap(container, p, data, { zoom = 14, label = '' } = {}) {
  const map = makeMap(container, [p.lat, p.lng], zoom);
  Leaflet.circleMarker([p.lat, p.lng], { radius: 10, weight: 3, color: css('--surface'), fillColor: css('--accent'), fillOpacity: 1 })
    .bindPopup(`<strong>${esc(label)}</strong><br><a href="${mapsLink(p.lat, p.lng)}" target="_blank" rel="noopener">${t('action.gmaps')}</a>`).addTo(map);
  const colors = { metro: '--series-1', school: '--series-3', hospital: '--bad', mall: '--series-4', beach: '--series-2' };
  for (const poi of data.poi) {
    Leaflet.circleMarker([poi.lat, poi.lng], { radius: 6, weight: 2, color: css('--surface'), fillColor: css(colors[poi.type] || '--ink-3'), fillOpacity: 0.95 })
      .bindTooltip(`${esc(L(poi))} (${t(`poi.${poi.type}`)})`).addTo(map);
  }
  for (const rw of data.noise?.runways || []) {
    Leaflet.polyline([rw.end1, rw.end2], { color: css('--ink-2'), weight: 4 }).bindTooltip(esc(rw.name)).addTo(map);
  }
  return map;
}

export function mapLegend() {
  const items = [['--accent', t('map.subject')], ['--series-1', t('poi.metro')], ['--series-3', t('poi.school')], ['--bad', t('poi.hospital')], ['--series-4', t('poi.mall')], ['--series-2', t('poi.beach')], ['--ink-2', t('map.runway')]];
  return `<div class="legend">${items.map(([c, l]) => `<span><i style="background:var(${c})"></i>${l}</span>`).join('')}</div>`;
}
