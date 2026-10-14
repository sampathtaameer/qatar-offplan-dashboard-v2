const dicts = {};
let lang = 'en';

// Browser storage, namespaced so v2 never collides with v1 served from the same address.
const NS = 'v2.';
export function stored(key, fallback) {
  try { return localStorage.getItem(NS + key) ?? fallback; } catch { return fallback; }
}
export function store(key, value) {
  try { localStorage.setItem(NS + key, value); } catch { /* storage unavailable */ }
}
export function storedJSON(key, fallback) {
  try { return JSON.parse(stored(key, '')) ?? fallback; } catch { return fallback; }
}

export async function initI18n() {
  const [en, ar] = await Promise.all(['en', 'ar'].map((l) => fetch(`i18n/${l}.json`).then((r) => r.json())));
  dicts.en = en; dicts.ar = ar;
  setLang(stored('lang', 'en'));
}

export function getLang() { return lang; }

export function setLang(next) {
  lang = next === 'ar' ? 'ar' : 'en';
  store('lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
}

export function t(key, vars = {}) {
  const s = dicts[lang]?.[key] ?? dicts.en?.[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// Bilingual record field: rec.name_en / rec.name_ar
export function L(rec, field = 'name') {
  if (!rec) return '';
  return rec[`${field}_${lang}`] || rec[`${field}_en`] || rec[field] || '';
}

export function nf(n, opts = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-QA' : 'en-QA', { maximumFractionDigits: 0, ...opts }).format(n);
}
export function qar(n, opts = {}) {
  if (n == null) return '—';
  return `${t('unit.qar')} ${nf(n, opts)}`;
}
export function qarShort(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e9) return `${t('unit.qar')} ${nf(n / 1e9, { maximumFractionDigits: 2 })}${t('unit.bn')}`;
  if (Math.abs(n) >= 1e6) return `${t('unit.qar')} ${nf(n / 1e6, { maximumFractionDigits: 1 })}${t('unit.mn')}`;
  return qar(n);
}
export function signedPct(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return '—';
  return (x > 0 ? '+' : '') + pct(x, digits);
}
export function pct(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return '—';
  return nf(x * 100, { maximumFractionDigits: digits, minimumFractionDigits: digits }) + '%';
}
export function km(m) {
  if (m == null) return '—';
  return m < 1000 ? `${nf(Math.round(m / 10) * 10)} ${t('unit.m')}` : `${nf(m / 1000, { maximumFractionDigits: 1 })} ${t('unit.km')}`;
}
export function monthFmt(ym) {
  if (!ym) return '—';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-QA' : 'en-GB', { month: 'short', year: 'numeric' }).format(new Date(`${ym.slice(0, 7)}-01T00:00:00`));
}
export function dateFmt(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-QA' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}
