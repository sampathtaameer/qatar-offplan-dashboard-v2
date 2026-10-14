import { t, L, nf, dateFmt } from '../i18n.js';
import { esc, deltaSpan, starBtn, exportBtn, toast, handoverCell } from '../ui.js';
import { fromPrice } from '../calc/pricing.js';
import { allWatched, localWatch, sharedWatch } from '../watch.js';
import { priceChange, handoverSlips } from './projects.js';
import { exportSheets, round } from '../export.js';

const TYPES = ['all', 'price', 'project', 'stock', 'handover', 'status', 'rent', 'data', 'rules'];

export function renderChanges(el, data) {
  const ids = allWatched().filter((id) => data.projectById[id]);
  let type = 'all';
  const present = new Set(data.changes.flatMap((c) => c.items.map((i) => i.type)));

  el.innerHTML = `
    <div class="page-head"><div><h1>${t('changes.title')}</h1><p class="muted">${t('changes.lede')}</p></div>
      <div class="page-actions"><button id="copyWatch" class="btn secondary" type="button">${t('watch.copy')}</button><a class="btn secondary" href="data/digest.html" target="_blank" rel="noopener">${t('changes.digest')}</a>${exportBtn()}</div></div>

    <div class="card table-wrap">
      <div class="card-head"><h2>★ ${t('watch.title')}</h2><span class="small muted">${t('watch.sub', { l: localWatch().length, s: sharedWatch().length })}</span></div>
      ${ids.length ? `<table><thead><tr><th></th><th>${t('col.project')}</th><th>${t('col.developer')}</th><th class="num">${t('col.fromPrice')}</th><th class="num">${t('watch.change', { d: dateFmt(data.history?.first) })}</th>
        <th>${t('col.stock')}</th><th>${t('col.status')}</th><th>${t('col.handover')}</th></tr></thead><tbody>
        ${ids.map((id) => { const p = data.projectById[id]; const s = handoverSlips(data, id);
          return `<tr class="${p.taameer ? 'taameer' : ''}"><td>${starBtn(id)}</td><td><a href="#/project/${id}">${esc(L(p))}</a>${sharedWatch().includes(id) ? ` <span class="mini">(${t('watch.inEmail')})</span>` : ''}</td><td>${esc(p.developer)}</td>
          <td class="num">${nf(fromPrice(p))}</td><td class="num">${deltaSpan(priceChange(data, id))}</td><td>${p.stock ? t(`stock.${p.stock}`) : '—'}</td><td>${t(`status.${p.status}`)}</td>
          <td>${handoverCell(p, data)}${s.slips ? ` <span class="delta down">${t('project.slipped', { n: s.slips, m: s.months })}</span>` : ''}</td></tr>`; }).join('')}</tbody></table>`
        : `<p class="muted">${t('watch.empty')}</p>`}
      <p class="small muted">${t('watch.emailNote')}</p>
    </div>

    ${data.review.length ? `<div class="card section table-wrap">
      <div class="card-head"><h2>${t('review.title')}</h2><span class="small muted">${t('review.sub', { n: data.review.length })}</span></div>
      <table><thead><tr><th>${t('col.project')}</th><th>${t('review.issue')}</th><th>${t('review.current')}</th><th>${t('review.listings')}</th><th class="num">${t('facts.brokers')}</th></tr></thead><tbody>
      ${data.review.map((r) => `<tr><td>${data.projectById[r.id] ? `<a href="#/project/${r.id}">${esc(r.name)}</a>` : esc(r.name)}</td><td>${t(`review.${r.kind}`)}</td>
        <td>${esc(r.current ?? '—')}</td><td>${esc(String(r.listings ?? '—'))}</td><td class="num">${nf(r.brokers)}</td></tr>`).join('')}</tbody></table>
      <p class="small muted">${t('review.note')}</p></div>` : ''}

    <div class="card section">
      <div class="card-head"><h2>${t('changes.log')}</h2></div>
      <div class="filters"><div class="seg">${TYPES.filter((x) => x === 'all' || present.has(x)).map((x) => `<button type="button" data-t="${x}" class="${x === type ? 'on' : ''}">${t(`ctype.${x}`)}</button>`).join('')}</div></div>
      <div id="log"></div>
    </div>`;

  const log = el.querySelector('#log');
  const draw = () => {
    const entries = data.changes.map((c) => ({ ...c, items: c.items.filter((i) => type === 'all' || i.type === type) })).filter((c) => c.items.length);
    log.innerHTML = entries.length ? `<ul class="changes">${entries.map((c) => `<li><strong>${dateFmt(c.date)}</strong><ul>${c.items.map((i) => `<li><span class="badge q">${t(`ctype.${i.type}`)}</span> ${i.id && data.projectById[i.id] ? `<a href="#/project/${i.id}">${esc(L(i, 'text'))}</a>` : esc(L(i, 'text'))}</li>`).join('')}</ul></li>`).join('')}</ul>`
      : `<p class="muted">${t('overview.noChanges')}</p>`;
  };
  el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
    type = b.dataset.t; el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b)); draw();
  }));
  el.querySelector('#copyWatch').addEventListener('click', async () => {
    const text = JSON.stringify({ as_of: new Date().toISOString().slice(0, 10), notes: data.raw.watchlist.notes, ids: allWatched() }, null, 1);
    try { await navigator.clipboard.writeText(text); toast(t('watch.copied')); } catch { toast(t('watch.copyFail')); }
  });
  el.querySelector('#exportBtn').addEventListener('click', () => exportSheets('changes', [
    { name: 'Watchlist', headers: ['Id', 'Project', 'Developer', 'From price QAR', 'Change since first snapshot', 'Stock', 'Status', 'Handover'],
      rows: ids.map((id) => { const p = data.projectById[id]; return [id, p.name_en, p.developer, fromPrice(p), round(priceChange(data, id), 4), p.stock, p.status, p.handover]; }) },
    { name: 'Change log', headers: ['Date', 'Type', 'Project id', 'Change'], rows: data.changes.flatMap((c) => c.items.map((i) => [c.date, i.type, i.id || '', i.text_en])) },
  ]));
  draw();
}
