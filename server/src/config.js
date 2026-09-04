import { query } from './db.js';

// ============================================================
// Default configuration for CEDIF Saint-Antoine.
// Everything here is editable from the Settings page (stored in
// the `settings` table under key 'config'). Nothing is hard-coded
// in the engine that could reasonably be a parameter.
// ============================================================
export const DEFAULT_CONFIG = {
  store: {
    name: 'CEDIF Saint-Antoine',
    address: '70 rue Saint-Antoine, 75004 Paris',
    // Opening hours per day type.
    weekday_open: '09:50',
    weekday_close: '19:40',
    sunday_open: '10:50',
    sunday_close: '19:10',
    open_days: [1, 2, 3, 4, 5, 6, 7], // ISO weekdays the store is open
  },
  coverage: {
    min_opening: 1, // people who must cover opening each day
    min_closing: 1, // people who must cover closing each day
    // HARD RULE: the store must never be empty during opening hours.
    // The generator guarantees continuous coverage by construction; breaks
    // are only placed when another employee is present.
    require_continuous: true,
    // Shortest usable presence/break segment (avoids tiny slivers).
    min_segment_minutes: 30,
  },
  shifts: {
    // Break inserted (unpaid) when a worked span is long.
    break_start: '14:00',
    break_end: '15:00',
    break_minutes: 60,
    // A worked day whose *span* exceeds this gets the midday break.
    break_threshold_minutes: 360, // 6h
    min_day_minutes: 180, // 3h — shortest working day
    // A "long day" for equity/penalty purposes.
    long_day_minutes: 500, // 8h20
  },
  order: {
    weekday: 2, // ISO: Tuesday
    deadline: '12:00',
    // Only these employees may perform the order (by flag is_order_manager).
    require_manager: true,
  },
  deliveries: {
    weekdays: [4, 5], // Thursday, Friday
  },
  noussia: {
    // Structural weekend-only constraint is enforced by employees.weekend_only.
    // Target split of her weekly hours between Saturday and Sunday (ratio).
    saturday_ratio: 0.55,
    sunday_ratio: 0.45,
  },
  rest: {
    // HARD RULE: guaranteed rest days per week (per employee, over the
    // 7-day week). 2 => an employee works at most 5 days a week. If honouring
    // this makes continuous coverage impossible, the generator reports it
    // instead of overworking someone. Can be overridden per employee via
    // employees.preferences.min_rest_days.
    min_days_per_week: 2,
  },
  rotation: {
    // How many weeks of history to weight for equity (0 = all history).
    history_weeks: 12,
    // Recent history counts more; decay per week older.
    decay: 0.9,
  },
  generator: {
    candidates: 60, // number of candidate plannings generated per run
    hours_tolerance_minutes: 60, // acceptable +/- vs contract before penalty
  },
  // Score weights. Higher weight = stronger penalty for violating.
  weights: {
    hours_over: 3, // per 15 min over contract
    hours_under: 3, // per 15 min under contract
    opening_missing: 100, // hard-ish: no opener
    closing_missing: 100, // no closer
    order_missing: 120, // no responsible for Tuesday order
    coverage_gap: 8, // midday uncovered slot (if require_continuous)
    saturday_balance: 6, // per unit of saturday inequity
    sunday_balance: 6,
    opening_balance: 4,
    closing_balance: 4,
    hours_balance: 2,
    long_day: 3, // per long day beyond a fair share
    consecutive_days: 4, // per day in a long run (>5 consecutive)
    preference_violation: 2, // per soft preference violated
  },
};

// Deep merge helper (objects only; arrays replaced).
function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override !== undefined ? override : base;
  }
  if (typeof base !== 'object' || base === null) {
    return override !== undefined ? override : base;
  }
  const out = { ...base };
  for (const key of Object.keys(override || {})) {
    if (
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key]) &&
      typeof override[key] === 'object' &&
      override[key] !== null
    ) {
      out[key] = deepMerge(base[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

// Load config merged with defaults (so new default keys always exist).
export async function loadConfig() {
  const { rows } = await query(`SELECT value FROM settings WHERE key = 'config'`);
  const stored = rows[0]?.value || {};
  return deepMerge(DEFAULT_CONFIG, stored);
}

export async function saveConfig(partial) {
  const merged = deepMerge(await loadConfig(), partial);
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('config', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [JSON.stringify(merged)]
  );
  return merged;
}
