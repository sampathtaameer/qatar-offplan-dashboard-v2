import { storedJSON, store } from './i18n.js';

// Watchlist: stars saved in this browser, plus the shared list in data/watchlist.json (used by the email digest).
let shared = [];
export function initWatch(ids) { shared = ids || []; }
export function localWatch() { return storedJSON('watch', []); }
export function sharedWatch() { return shared; }
export function isWatched(id) { return localWatch().includes(id) || shared.includes(id); }
export function allWatched() { return [...new Set([...shared, ...localWatch()])]; }
export function toggleWatch(id) {
  const ids = localWatch();
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  store('watch', JSON.stringify(next));
  return next.includes(id);
}
