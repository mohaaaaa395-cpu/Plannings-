-- ============================================================
-- CEDIF Saint-Antoine — Planning application schema
-- Idempotent: safe to run repeatedly (CREATE TABLE IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  username     TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'admin',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Employees & contracts
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  position          TEXT NOT NULL DEFAULT 'Employé(e)',
  has_keys          BOOLEAN NOT NULL DEFAULT true,
  is_order_manager  BOOLEAN NOT NULL DEFAULT false,
  weekend_only      BOOLEAN NOT NULL DEFAULT false,
  color             TEXT NOT NULL DEFAULT '#2563eb',
  preferences       JSONB NOT NULL DEFAULT '{}'::jsonb,
  active            BOOLEAN NOT NULL DEFAULT true,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contract history. The row with the latest effective_from and no
-- effective_to (or covering the target date) is the active contract.
CREATE TABLE IF NOT EXISTS contracts (
  id             SERIAL PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  weekly_minutes INTEGER NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_employee ON contracts(employee_id);

-- ---------------------------------------------------------------
-- Availability & preferences
-- weekday: ISO 1=Monday .. 7=Sunday. NULL = applies to all days.
-- kind: 'unavailable' | 'available' | 'preferred' | 'avoid'
-- is_hard: true = hard constraint, false = preference
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  weekday      INTEGER,
  kind         TEXT NOT NULL DEFAULT 'unavailable',
  is_hard      BOOLEAN NOT NULL DEFAULT true,
  start_time   TEXT,
  end_time     TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_availability_employee ON availability(employee_id);

-- ---------------------------------------------------------------
-- Absences / leave
-- type: 'conges' | 'formation' | 'maladie' | 'absence' | 'indisponibilite' | 'autre'
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS absences (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'conges',
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_absences_employee ON absences(employee_id);
CREATE INDEX IF NOT EXISTS idx_absences_dates ON absences(start_date, end_date);

-- ---------------------------------------------------------------
-- Schedules (a generation covering 3 consecutive weeks)
-- status: 'draft' | 'validated' | 'archived'
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
  id           SERIAL PRIMARY KEY,
  label        TEXT,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  version      INTEGER NOT NULL DEFAULT 1,
  parent_id    INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  score        NUMERIC,
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status);
CREATE INDEX IF NOT EXISTS idx_schedules_dates ON schedules(start_date, end_date);

CREATE TABLE IF NOT EXISTS schedule_weeks (
  id           SERIAL PRIMARY KEY,
  schedule_id  INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  week_index   INTEGER NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weeks_schedule ON schedule_weeks(schedule_id);

CREATE TABLE IF NOT EXISTS schedule_days (
  id               SERIAL PRIMARY KEY,
  schedule_week_id INTEGER NOT NULL REFERENCES schedule_weeks(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  weekday          INTEGER NOT NULL,       -- ISO 1..7
  is_sunday        BOOLEAN NOT NULL DEFAULT false,
  open_time        TEXT NOT NULL,
  close_time       TEXT NOT NULL,
  events           JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_days_week ON schedule_days(schedule_week_id);

CREATE TABLE IF NOT EXISTS schedule_shifts (
  id               SERIAL PRIMARY KEY,
  schedule_day_id  INTEGER NOT NULL REFERENCES schedule_days(id) ON DELETE CASCADE,
  employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  is_rest          BOOLEAN NOT NULL DEFAULT false,
  morning_start    TEXT,
  morning_end      TEXT,
  afternoon_start  TEXT,
  afternoon_end    TEXT,
  worked_minutes   INTEGER NOT NULL DEFAULT 0,
  is_opening       BOOLEAN NOT NULL DEFAULT false,
  is_closing       BOOLEAN NOT NULL DEFAULT false,
  is_order         BOOLEAN NOT NULL DEFAULT false,
  role             TEXT,
  is_manual        BOOLEAN NOT NULL DEFAULT false,
  note             TEXT
);
CREATE INDEX IF NOT EXISTS idx_shifts_day ON schedule_shifts(schedule_day_id);
CREATE INDEX IF NOT EXISTS idx_shifts_employee ON schedule_shifts(employee_id);

-- ---------------------------------------------------------------
-- Manual changes audit (never silently overwritten)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual_changes (
  id           SERIAL PRIMARY KEY,
  schedule_id  INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  date         DATE,
  change_type  TEXT NOT NULL,
  before_state JSONB,
  after_state  JSONB,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manual_schedule ON manual_changes(schedule_id);

-- ---------------------------------------------------------------
-- Orders (commande) & deliveries (livraison)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  schedule_id  INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  deadline     TEXT NOT NULL DEFAULT '12:00',
  done         BOOLEAN NOT NULL DEFAULT false,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_schedule ON orders(schedule_id);

CREATE TABLE IF NOT EXISTS deliveries (
  id           SERIAL PRIMARY KEY,
  schedule_id  INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_deliveries_schedule ON deliveries(schedule_id);

-- ---------------------------------------------------------------
-- Equity statistics: one row per (validated schedule, employee, week)
-- Enables long-term, period-based equity analysis.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equity_statistics (
  id             SERIAL PRIMARY KEY,
  schedule_id    INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_index     INTEGER NOT NULL,
  week_start     DATE NOT NULL,
  saturdays      INTEGER NOT NULL DEFAULT 0,
  sundays        INTEGER NOT NULL DEFAULT 0,
  weekends       INTEGER NOT NULL DEFAULT 0,
  openings       INTEGER NOT NULL DEFAULT 0,
  closings       INTEGER NOT NULL DEFAULT 0,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  worked_days    INTEGER NOT NULL DEFAULT 0,
  long_days      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_equity_employee ON equity_statistics(employee_id);
CREATE INDEX IF NOT EXISTS idx_equity_weekstart ON equity_statistics(week_start);
CREATE INDEX IF NOT EXISTS idx_equity_schedule ON equity_statistics(schedule_id);

-- ---------------------------------------------------------------
-- Settings: flexible key/value store (JSONB)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
