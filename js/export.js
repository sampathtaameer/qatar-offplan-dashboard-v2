// Excel export (SheetJS from cdnjs). Falls back to CSV of the first sheet if the library is unavailable.
// sheets: [{ name, headers: [...], rows: [[...], ...] }] — keep numbers as numbers so Excel can calculate.
export function exportSheets(filename, sheets) {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${filename}-${stamp}`;
  const X = window.XLSX;
  if (X) {
    const wb = X.utils.book_new();
    for (const s of sheets) {
      const ws = X.utils.aoa_to_sheet([s.headers, ...s.rows.map((r) => r.map((c) => (c == null || Number.isNaN(c) ? '' : c)))]);
      ws['!cols'] = s.headers.map((h, i) => ({ wch: Math.min(48, Math.max(10, String(h).length + 2, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 1))) }));
      X.utils.book_append_sheet(wb, ws, s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    }
    X.writeFile(wb, `${name}.xlsx`);
    return 'xlsx';
  }
  const s = sheets[0];
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const text = '﻿' + [s.headers, ...s.rows].map((r) => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}.csv`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return 'csv';
}

export const round = (x, d = 0) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
