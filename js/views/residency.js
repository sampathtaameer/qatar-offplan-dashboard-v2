import { t, L, nf, qar, dateFmt } from '../i18n.js';
import { esc, regimeBadge, sourceNote, calcPanel } from '../ui.js';
import { residencyCheck } from '../calc/residency.js';

export function renderResidency(el, data, query = '') {
  const qs = new URLSearchParams(query);
  const areas = data.areas.slice().sort((a, b) => L(a).localeCompare(L(b)));

  el.innerHTML = `
    <div class="page-head"><div><h1>${t('residency.pageTitle')}</h1><p class="muted">${t('residency.lede')}</p></div></div>
    <div class="grid g-2">
      <div class="card">
        <div class="filters">
          <label class="field">${t('residency.price')}<input id="price" type="number" min="0" step="10000" value="${esc(qs.get('price') || '')}" placeholder="1500000"></label>
          <label class="field">${t('col.area')}<select id="area">${areas.map((a) => `<option value="${a.id}" ${a.id === qs.get('area') ? 'selected' : ''}>${esc(L(a))}</option>`).join('')}</select></label>
        </div>
        <div id="out"></div>
      </div>
      <div class="card">
        <h2>${t('residency.rules')}</h2>
        <div class="table-wrap"><table><thead><tr><th>${t('residency.tier')}</th><th class="num">${t('residency.min')}</th><th>${t('residency.benefits')}</th></tr></thead><tbody>
          ${data.rules.residency.map((r) => `<tr><td>${esc(L(r, 'label'))}</td><td class="num">${nf(r.threshold_qar)}</td><td>${esc(L(r, 'benefits'))}</td></tr>`).join('')}
        </tbody></table></div>
        <h3 class="section">${t('residency.regimes')}</h3>
        <ul>${data.rules.regimes.map((r) => `<li>${regimeBadge(r.id)} ${esc(L(r, 'desc'))}</li>`).join('')}</ul>
        ${sourceNote(data.rules.residency[0])}
        <p class="small muted">${t('residency.verify')} ${dateFmt(data.rules.as_of)}.</p>
      </div>
    </div>`;

  const out = el.querySelector('#out');
  const draw = () => {
    const price = Number(el.querySelector('#price').value) || 0;
    const area = data.areaById[el.querySelector('#area').value];
    const r = residencyCheck({ priceQar: price, regime: area.regime }, data.rules);
    out.innerHTML = `
      <p>${regimeBadge(area.regime)} ${esc(L(r.regimeRule, 'desc'))}</p>
      ${!r.foreignEligible ? `<p class="badge bad">${t('residency.notForeign')}</p>` : `
      <table><tbody>${r.tiers.map((tier) => `<tr><td>${esc(L(tier, 'label'))}</td>
        <td>${tier.meets ? `<span class="badge good">✓ ${t('residency.meets')}</span>` : `<span class="badge warn">${t('residency.short', { gap: qar(tier.gapQar) })}</span>`}</td></tr>`).join('')}
      </tbody></table>`}
      ${calcPanel(t('calc.how'), `<p>${t('calc.residencyBody')}</p>`)}`;
  };
  el.querySelectorAll('input, select').forEach((i) => i.addEventListener('input', draw));
  draw();
}
