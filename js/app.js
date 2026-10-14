import { loadData } from './data.js';
import { initI18n, setLang, getLang, t, store, stored, dateFmt } from './i18n.js';
import { destroyCharts, destroyMaps, esc, toast } from './ui.js';
import { initAssumptions, openSettings } from './settings.js';
import { initWatch, toggleWatch } from './watch.js';
import { renderOverview } from './views/overview.js';
import { renderFocus } from './views/focus.js';
import { renderAreas, renderArea } from './views/areas.js';
import { renderProjects, renderProject } from './views/projects.js';
import { renderCompare } from './views/compare.js';
import { renderDevelopers } from './views/developers.js';
import { renderTaameer } from './views/taameer.js';

const routes = [
  [/^#\/overview$/, renderOverview, 'overview'],
  [/^#\/focus$/, renderFocus, 'focus'],
  [/^#\/areas$/, renderAreas, 'areas'],
  [/^#\/area\/([\w-]+)$/, renderArea, 'areas'],
  [/^#\/projects(?:\?(.*))?$/, renderProjects, 'projects'],
  [/^#\/project\/([\w-]+)$/, renderProject, 'projects'],
  [/^#\/compare(?:\?(.*))?$/, renderCompare, 'compare'],
  [/^#\/developers$/, renderDevelopers, 'developers'],
  [/^#\/taameer$/, renderTaameer, 'taameer'],
];

let data;
const view = document.getElementById('view');

async function render() {
  const hash = location.hash || '#/overview';
  const match = routes.find(([re]) => re.test(hash));
  if (!match) { location.hash = '#/overview'; return; }
  const [re, fn, nav] = match;
  const params = hash.match(re).slice(1);
  destroyCharts();
  destroyMaps();
  document.querySelectorAll('.mainnav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${nav}`));
  try {
    await fn(view, data, ...params);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card empty">${esc(t('error.render'))}<br><code>${esc(err.message)}</code></div>`;
  }
  renderFreshness();
}

function renderFreshness() {
  const m = data.meta;
  const stale = Object.entries(m).filter(([, v]) => v.stale).map(([k]) => t(`file.${k}`));
  document.getElementById('freshness').innerHTML =
    `${t('footer.updated')} ${dateFmt(m.transactions.as_of)} · ${t('footer.listings')} ${dateFmt(m.projects.as_of)}` +
    (stale.length ? ` · <span class="conf-low">${esc(t('footer.stale'))}: ${esc(stale.join(', '))}</span>` : '');
}

function initToggles() {
  // Theme: light (default, Taameer house style) → dark → auto. Charts and maps read CSS colours when drawn, so re-render.
  const themeBtn = document.getElementById('themeToggle');
  const THEMES = ['light', 'dark', 'auto'];
  const ICONS = { auto: '◐', light: '☀', dark: '☾' };
  let theme = stored('theme', 'light');
  if (!THEMES.includes(theme)) theme = 'light';
  const applyTheme = () => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    themeBtn.textContent = ICONS[theme];
    const label = `${t('theme.label')}: ${t(`theme.${theme}`)}`;
    themeBtn.title = label;
    themeBtn.setAttribute('aria-label', label);
  };
  applyTheme();
  themeBtn.addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    store('theme', theme);
    applyTheme();
    render();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'auto') render(); });

  const langBtn = document.getElementById('langToggle');
  const settingsBtn = document.getElementById('settingsBtn');
  const syncLabels = () => {
    langBtn.textContent = getLang() === 'ar' ? 'English' : 'عربي';
    settingsBtn.title = t('assume.title');
    settingsBtn.setAttribute('aria-label', t('assume.title'));
  };
  syncLabels();
  langBtn.addEventListener('click', () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); syncLabels(); applyTheme(); render(); });
  settingsBtn.addEventListener('click', () => openSettings(() => { toast(t('assume.saved')); render(); }));

  const analyst = document.getElementById('analystToggle');
  const on = stored('analyst', '0') === '1';
  analyst.checked = on;
  document.body.classList.toggle('analyst', on);
  analyst.addEventListener('change', () => {
    document.body.classList.toggle('analyst', analyst.checked);
    store('analyst', analyst.checked ? '1' : '0');
  });

  // Watchlist stars anywhere on the page.
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.star;
    const on = toggleWatch(id);
    const shared = data.watchShared.includes(id);
    document.querySelectorAll(`[data-star="${CSS.escape(id)}"]`).forEach((s) => {
      const lit = on || shared;
      s.classList.toggle('on', lit); s.textContent = lit ? '★' : '☆'; s.setAttribute('aria-pressed', String(lit));
    });
    toast(on ? t('watch.added') : shared ? t('watch.shared') : t('watch.removed'));
  });
}

async function boot() {
  try {
    await initI18n();
    data = await loadData();
  } catch (err) {
    view.innerHTML = `<div class="card empty">Could not load data. Serve this folder over HTTP (python -I tools/serve.py), not file://.<br><code>${esc(err.message)}</code></div>`;
    return;
  }
  initAssumptions(data.defaults, data.raw.watchlist.notes);
  initWatch(data.watchShared);
  initToggles();
  window.addEventListener('hashchange', render);
  render();
}

boot();
