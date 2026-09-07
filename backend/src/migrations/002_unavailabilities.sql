-- ============================================================
-- Date-specific (or recurring) employee unavailabilities.
-- Hard constraint: the generator must never schedule an employee
-- during an unavailability.
--   - date      : a specific date (nullable)
--   - weekday   : recurring ISO weekday 1..7 (nullable)
--     (at least one of date / weekday is set)
--   - all_day   : true = unavailable the whole day
--   - start_time/end_time : "HH:MM" window when not all_day
-- ============================================================
CREATE TABLE IF NOT EXISTS unavailabilities (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date         DATE,
  weekday      INTEGER,
  all_day      BOOLEAN NOT NULL DEFAULT true,
  start_time   TEXT,
  end_time     TEXT,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unavail_employee ON unavailabilities(employee_id);
CREATE INDEX IF NOT EXISTS idx_unavail_date ON unavailabilities(date);
CREATE INDEX IF NOT EXISTS idx_unavail_weekday ON unavailabilities(weekday);
