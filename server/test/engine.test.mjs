// Standalone engine smoke test (no database). Run: node test/engine.test.mjs
import assert from 'assert';
import { DEFAULT_CONFIG } from '../src/config.js';
import { buildThreeWeeks } from '../src/dates.js';
import { normalizeTime, formatDuration, shiftMinutes } from '../src/time.js';
import { buildShift } from '../src/engine/shifts.js';
import { generate } from '../src/engine/generator.js';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

console.log('Time normalization:');
check('9h50 -> 09:50', () => assert.equal(normalizeTime('9h50'), '09:50'));
check('15h -> 15:00', () => assert.equal(normalizeTime('15h'), '15:00'));
check('9h15 -> 09:15', () => assert.equal(normalizeTime('9h15'), '09:15'));
check('09:50 -> 09:50', () => assert.equal(normalizeTime('09:50'), '09:50'));
check('950 -> 09:50', () => assert.equal(normalizeTime('950'), '09:50'));
check('invalid -> null', () => assert.equal(normalizeTime('abc'), null));
check('duration 530 -> 08:50', () => assert.equal(formatDuration(530), '08:50'));

console.log('Dates:');
const w = buildThreeWeeks('2026-09-07');
check('3 weeks', () => assert.equal(w.weeks.length, 3));
check('week1 start', () => assert.equal(w.weeks[0].start_date, '2026-09-07'));
check('week1 end', () => assert.equal(w.weeks[0].end_date, '2026-09-13'));
check('week3 end', () => assert.equal(w.weeks[2].end_date, '2026-09-27'));
check('end_date', () => assert.equal(w.end_date, '2026-09-27'));
check('monday is iso1', () => assert.equal(w.weeks[0].days[0].weekday, 1));
check('sunday is iso7', () => assert.equal(w.weeks[0].days[6].weekday, 7));

console.log('Shift builder (weekday full = 08:50):');
const full = buildShift(DEFAULT_CONFIG, false, 'full', 0);
check('full worked 530', () => assert.equal(full.worked_minutes, 530));
check('full morning', () => assert.equal(full.morning_start + '-' + full.morning_end, '09:50-14:00'));
check('full afternoon', () => assert.equal(full.afternoon_start + '-' + full.afternoon_end, '15:00-19:40'));
check('full opens', () => assert.equal(full.is_opening, true));
check('full closes', () => assert.equal(full.is_closing, true));

const sundayFull = buildShift(DEFAULT_CONFIG, true, 'full', 0);
check('sunday full worked 440 (07:20)', () => assert.equal(sundayFull.worked_minutes, 440));

const closer = buildShift(DEFAULT_CONFIG, false, 'close', 280);
check('closer afternoon 15:00-19:40', () =>
  assert.equal(closer.afternoon_start + '-' + closer.afternoon_end, '15:00-19:40'));
check('closer worked 280', () => assert.equal(closer.worked_minutes, 280));
check('closer closes', () => assert.equal(closer.is_closing, true));

const opener = buildShift(DEFAULT_CONFIG, false, 'open', 250);
check('opener morning 09:50-14:00', () =>
  assert.equal(opener.morning_start + '-' + opener.morning_end, '09:50-14:00'));
check('opener opens', () => assert.equal(opener.is_opening, true));

console.log('Full generation (3 weeks, default team):');
const employees = [
  { id: 1, name: 'Yassine', position: 'Directeur', has_keys: true, is_order_manager: true, weekend_only: false, contract_minutes: 2100, availability: [], preferences: {} },
  { id: 2, name: 'Rose', position: 'Responsable', has_keys: true, is_order_manager: true, weekend_only: false, contract_minutes: 2100, availability: [], preferences: {} },
  { id: 3, name: 'Jennyfer', position: 'Employée', has_keys: true, is_order_manager: false, weekend_only: false, contract_minutes: 1500, availability: [], preferences: {} },
  { id: 4, name: 'Noussia', position: 'Employée', has_keys: true, is_order_manager: false, weekend_only: true, contract_minutes: 900, availability: [], preferences: {} },
];
const ctx = {
  config: DEFAULT_CONFIG,
  employees,
  absencesByEmp: {},
  weeks: buildThreeWeeks('2026-09-07'),
  weightedHistory: {},
};
const result = generate(ctx);
check('feasible', () => assert.equal(result.feasible, true));
check('has best', () => assert.ok(result.best));
check('score is number', () => assert.ok(typeof result.best.score === 'number'));
console.log(`     score = ${result.best.score}/100, candidates = ${result.candidatesTried}`);

// Hard rule: Noussia never Mon-Fri
check('Noussia only weekend', () => {
  for (const week of result.best.weeks) {
    for (const day of week.days) {
      const s = day.shifts.find((x) => x.employee_id === 4 && !x.is_rest);
      if (s) assert.ok(day.weekday === 6 || day.weekday === 7, `Noussia works weekday ${day.weekday} on ${day.date}`);
    }
  }
});

// Hard rule: every open day has an opener and a closer
check('opening & closing covered each day', () => {
  for (const week of result.best.weeks) {
    for (const day of week.days) {
      const working = day.shifts.filter((s) => !s.is_rest);
      assert.ok(working.some((s) => s.is_opening), `no opener ${day.date}`);
      assert.ok(working.some((s) => s.is_closing), `no closer ${day.date}`);
    }
  }
});

// Hard rule: Tuesday order by a manager present in the morning
check('Tuesday order by manager before 12:00', () => {
  for (const week of result.best.weeks) {
    for (const day of week.days) {
      if (day.weekday !== 2) continue;
      const orderShift = day.shifts.find((s) => s.is_order && !s.is_rest);
      assert.ok(orderShift, `no order shift ${day.date}`);
      const emp = employees.find((e) => e.id === orderShift.employee_id);
      assert.ok(emp.is_order_manager, `order by non-manager ${day.date}`);
      const ms = orderShift.morning_start;
      assert.ok(ms && ms < '12:00', `order manager not present before 12:00 ${day.date}`);
    }
  }
});

// Contract sanity: totals within reasonable range
console.log('Contract totals (avg/week):');
for (const emp of employees) {
  const pe = result.best.perEmployee[emp.id];
  const total = pe.plannedMinutesByWeek.reduce((a, b) => a + b, 0);
  console.log(`     ${emp.name}: ${formatDuration(Math.round(total / 3))}/sem (contrat ${formatDuration(emp.contract_minutes)})`);
}

console.log('\nInfeasibility detection:');
const ctx2 = {
  config: DEFAULT_CONFIG,
  employees: employees.map((e) => (e.is_order_manager ? { ...e, availability: [{ weekday: 2, kind: 'unavailable', is_hard: true }] } : e)),
  absencesByEmp: {},
  weeks: buildThreeWeeks('2026-09-07'),
  weightedHistory: {},
};
const r2 = generate(ctx2);
check('infeasible when no manager on Tuesday', () => assert.equal(r2.feasible, false));
check('reason mentions responsable', () => assert.ok(r2.reasons.join(' ').toLowerCase().includes('responsable')));

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
