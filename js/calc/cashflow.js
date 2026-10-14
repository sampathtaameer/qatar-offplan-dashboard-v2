// Payment-plan cash flow for one unit, month by month from today.
// Plan shares come from the published plan text (tools/apply_overrides.py) or the Taameer template.
//  - down payment: month 0
//  - during construction: equal monthly instalments over the stated years, or until handover
//  - on handover: the handover month
//  - after handover: equal monthly instalments over the stated years (3 years if not stated)
// Investor view: buy now, receive net rent from handover, sell `hold` years after handover at
// price × (1 + growth)^(years from today), less selling costs; unpaid instalments are settled at sale.

export const DEFAULT_AFTER_YEARS = 3;

export function monthsUntil(ym, from = new Date()) {
  if (!ym) return null;
  const [y, m] = ym.split('-').map(Number);
  return (y - from.getFullYear()) * 12 + (m - 1 - from.getMonth());
}

export function buildCashflow({ plan, price, handover, rentMonthly = null, sizeSqm = null, a, today = new Date() }) {
  const flags = [];
  let H = monthsUntil(handover, today);
  if (H == null) { H = 24; flags.push('noHandover'); }
  if (H < 0) H = 0;
  const pay = new Map();
  const add = (m, v) => pay.set(m, (pay.get(m) || 0) + v);

  add(0, plan.down * price);
  if (plan.during > 0) {
    const n = plan.years_during ? Math.round(plan.years_during * 12) : Math.max(H, 1);
    for (let m = 1; m <= n; m++) add(m, (plan.during * price) / n);
  }
  if (plan.handover > 0) add(H, plan.handover * price);
  let afterYears = plan.years_after;
  if (plan.after > 0) {
    if (!afterYears) { afterYears = DEFAULT_AFTER_YEARS; flags.push('afterAssumed'); }
    const n = Math.round(afterYears * 12);
    for (let m = 1; m <= n; m++) add(H + m, (plan.after * price) / n);
  }
  if (plan.remainder_assumed) flags.push('remainderAssumed');

  const lastPay = Math.max(...pay.keys());
  const X = H + Math.round((a.hold_years_after_handover || 0) * 12); // exit month
  const exitGross = price * Math.pow(1 + a.price_growth_pa, X / 12);
  const exitNet = exitGross * (1 - a.selling_costs);
  const rentNet = rentMonthly ? rentMonthly * (1 - a.vacancy) - (sizeSqm ? a.service_charge_qar_sqm_month * sizeSqm : 0) : 0;

  const rows = [];
  let cum = 0, peak = 0, unpaidAtExit = 0;
  const end = Math.max(lastPay, X);
  for (let m = 0; m <= end; m++) {
    const p = pay.get(m) || 0;
    if (m > X) { unpaidAtExit += p; continue; }
    const fees = m === 0 ? price * a.purchase_fees : 0;
    const rent = m > H && m <= X ? rentNet : 0;
    let exit = 0;
    if (m === X) exit = exitNet;
    rows.push({ m, pay: p, fees, rent, exit, settle: 0, net: -p - fees + rent + exit });
  }
  if (unpaidAtExit) { const r = rows[rows.length - 1]; r.settle = unpaidAtExit; r.net -= unpaidAtExit; }
  for (const r of rows) { cum += r.net; peak = Math.min(peak, cum); r.cum = cum; }

  const d = a.discount_rate;
  let pv = 0;
  for (const [m, v] of pay) pv += v / Math.pow(1 + d, m / 12);
  const totalIn = rows.reduce((s, r) => s + r.rent + r.exit, 0);
  const totalOut = rows.reduce((s, r) => s + r.pay + r.fees + r.settle, 0);
  const irrM = irr(rows.map((r) => r.net));
  return {
    rows, H, X, afterYears, flags,
    schedule: [...pay.entries()].sort((x, y) => x[0] - y[0]),
    pv, pvDiscount: 1 - pv / price,
    paidByHandover: [...pay.entries()].filter(([m]) => m <= H).reduce((s, [, v]) => s + v, 0) / price,
    irr: irrM == null ? null : Math.pow(1 + irrM, 12) - 1,
    multiple: totalOut ? totalIn / totalOut : null,
    peakEquity: -peak, profit: totalIn - totalOut, exitGross,
  };
}

// Monthly IRR by bisection; null when the flows never change sign.
export function irr(flows) {
  if (!flows.some((f) => f > 0) || !flows.some((f) => f < 0)) return null;
  const npv = (r) => flows.reduce((s, f, i) => s + f / Math.pow(1 + r, i), 0);
  let lo = -0.99, hi = 1;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2, f = npv(mid);
    if (Math.abs(f) < 1e-6) return mid;
    if (f * flo < 0) { hi = mid; fhi = f; } else { lo = mid; flo = f; }
  }
  return (lo + hi) / 2;
}
