import { t, storedJSON, store, pct } from './i18n.js';
import { esc, toast } from './ui.js';
import { allWatched } from './watch.js';

// Assumptions: defaults from data/assumptions.json, per-browser changes on top.
const KEYS = [
  ['service_charge_qar_sqm_month', 'num'], ['vacancy', 'pct'], ['purchase_fees', 'pct'], ['selling_costs', 'pct'],
  ['price_growth_pa', 'pct'], ['discount_rate', 'pct'], ['hold_years_after_handover', 'num'],
];
let defaults = {};
let watchNotes = '';
export function initAssumptions(d, notes) { defaults = d || {}; watchNotes = notes || ''; }
export function getAssumptions() {
  const mine = storedJSON('assumptions', {});
  return Object.fromEntries(KEYS.map(([k]) => [k, typeof mine[k] === 'number' ? mine[k] : defaults[k]]));
}
export function isCustomised() { return Object.keys(storedJSON('assumptions', {})).length > 0; }

export function assumptionsLine() {
  const a = getAssumptions();
  return t('assume.line', {
    sc: a.service_charge_qar_sqm_month, vac: pct(a.vacancy, 0), fees: pct(a.purchase_fees, 0), sell: pct(a.selling_costs, 0),
    g: pct(a.price_growth_pa, 1), d: pct(a.discount_rate, 1), hold: a.hold_years_after_handover,
  }) + (isCustomised() ? ` · ${t('assume.custom')}` : '');
}

export function openSettings(onChange) {
  const a = getAssumptions();
  const bg = document.createElement('div');
  bg.className = 'drawer-bg';
  const dr = document.createElement('aside');
  dr.className = 'drawer';
  dr.setAttribute('role', 'dialog');
  dr.setAttribute('aria-label', t('assume.title'));
  dr.innerHTML = `<h2>${esc(t('assume.title'))} <button class="btn secondary small" data-close>×</button></h2>
    <p class="small muted">${esc(t('assume.lede'))}</p>
    ${KEYS.map(([k, kind]) => `<label class="field">${esc(t(`assume.${k}`))}
      <input type="number" step="${kind === 'pct' ? '0.5' : '1'}" data-k="${k}" data-kind="${kind}" value="${kind === 'pct' ? +(a[k] * 100).toFixed(2) : a[k]}">
      <span class="mini">${esc(t('assume.default'))}: ${kind === 'pct' ? pct(defaults[k], 1) : defaults[k]}</span></label>`).join('')}
    <div class="page-actions"><button class="btn" data-save>${esc(t('assume.apply'))}</button><button class="btn secondary" data-reset>${esc(t('assume.reset'))}</button></div>
    <h3 class="section">★ ${esc(t('watch.title'))}</h3>
    <p class="small muted">${esc(t('watch.emailNote'))}</p>
    <div class="page-actions"><button class="btn secondary" data-copywatch>${esc(t('watch.copy'))}</button><a class="btn secondary" href="data/digest.html" target="_blank" rel="noopener">${esc(t('changes.digest'))}</a></div>`;
  const close = () => { bg.remove(); dr.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.addEventListener('click', close);
  dr.querySelector('[data-close]').addEventListener('click', close);
  dr.querySelector('[data-reset]').addEventListener('click', () => { store('assumptions', '{}'); close(); onChange(); });
  dr.querySelector('[data-save]').addEventListener('click', () => {
    const mine = {};
    dr.querySelectorAll('input[data-k]').forEach((i) => {
      const v = Number(i.value);
      if (i.value === '' || Number.isNaN(v)) return;
      const val = i.dataset.kind === 'pct' ? v / 100 : v;
      if (val !== defaults[i.dataset.k]) mine[i.dataset.k] = val;
    });
    store('assumptions', JSON.stringify(mine));
    close();
    onChange();
  });
  dr.querySelector('[data-copywatch]').addEventListener('click', async () => {
    const text = JSON.stringify({ as_of: new Date().toISOString().slice(0, 10), notes: watchNotes, ids: allWatched() }, null, 1);
    try { await navigator.clipboard.writeText(text); toast(t('watch.copied')); } catch { toast(t('watch.copyFail')); }
  });
  document.addEventListener('keydown', onKey);
  document.body.append(bg, dr);
  dr.querySelector('input')?.focus();
}
