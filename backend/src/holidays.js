import { formatDate, addDays } from './dates.js';

// ============================================================
// Jours fériés (le magasin est fermé ces jours-là).
// Jours fériés français (métropole) calculés pour n'importe quelle année,
// y compris les fêtes mobiles basées sur Pâques (lundi de Pâques, Ascension,
// lundi de Pentecôte). L'utilisateur peut ajouter des fermetures ponctuelles
// (ponts, congés annuels) et déclarer des exceptions où le magasin ouvre.
// ============================================================

// Dimanche de Pâques (algorithme de Meeus/Jones/Butcher, calendrier grégorien).
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=mars, 4=avril
  const dayN = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, dayN));
}

// Jours fériés français pour une année donnée -> [{ date:'YYYY-MM-DD', name }].
export function frenchHolidays(year) {
  const easter = easterSunday(year);
  const fixed = [
    [`${year}-01-01`, "Jour de l'an"],
    [`${year}-05-01`, 'Fête du travail'],
    [`${year}-05-08`, 'Victoire 1945'],
    [`${year}-07-14`, 'Fête nationale'],
    [`${year}-08-15`, 'Assomption'],
    [`${year}-11-01`, 'Toussaint'],
    [`${year}-11-11`, 'Armistice 1918'],
    [`${year}-12-25`, 'Noël'],
  ];
  const movable = [
    [formatDate(addDays(easter, 1)), 'Lundi de Pâques'],
    [formatDate(addDays(easter, 39)), 'Ascension'],
    [formatDate(addDays(easter, 50)), 'Lundi de Pentecôte'],
  ];
  return [...fixed, ...movable].map(([date, name]) => ({ date, name }));
}

// Cache par année pour éviter de recalculer.
const _cache = new Map();
function holidaysFor(year) {
  if (!_cache.has(year)) {
    const map = new Map();
    for (const h of frenchHolidays(year)) map.set(h.date, h.name);
    _cache.set(year, map);
  }
  return _cache.get(year);
}

function normalizeExtra(list) {
  // Accepte des chaînes "YYYY-MM-DD" ou des objets { date, label }.
  const out = new Map();
  for (const item of list || []) {
    if (!item) continue;
    if (typeof item === 'string') {
      const d = item.slice(0, 10);
      if (d) out.set(d, 'Fermeture exceptionnelle');
    } else if (item.date) {
      out.set(String(item.date).slice(0, 10), item.label || 'Fermeture exceptionnelle');
    }
  }
  return out;
}

// Renseigne si le magasin est fermé ce jour-là pour cause de férié / fermeture,
// et le libellé. Renvoie { closed:boolean, name:string|null }.
export function holidayInfo(dateStr, config) {
  const h = (config && config.holidays) || {};
  if (h.closed === false) return { closed: false, name: null };
  const date = String(dateStr).slice(0, 10);

  // Exception : le magasin ouvre exceptionnellement ce jour férié.
  const openOn = new Set((h.open_on || []).map((x) => String(x).slice(0, 10)));
  if (openOn.has(date)) return { closed: false, name: null };

  // Fermetures ponctuelles saisies (ponts, congés annuels…).
  const extra = normalizeExtra(h.extra);
  if (extra.has(date)) return { closed: true, name: extra.get(date) };

  // Jours fériés français (sauf si la case est décochée).
  if (h.observe_french !== false) {
    const year = parseInt(date.slice(0, 4), 10);
    const map = holidaysFor(year);
    if (map.has(date)) return { closed: true, name: map.get(date) };
  }
  return { closed: false, name: null };
}

export function isHoliday(dateStr, config) {
  return holidayInfo(dateStr, config).closed;
}
