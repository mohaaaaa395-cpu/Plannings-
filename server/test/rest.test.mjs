// Rest-day constraint tests (no database). Run: node test/rest.test.mjs
import assert from 'assert';
import { DEFAULT_CONFIG } from '../src/config.js';
import { buildThreeWeeks } from '../src/dates.js';
import { generate } from '../src/engine/generator.js';

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

function team() {
  return [
    { id: 1, name: 'Yassine', position: 'Directeur', has_keys: true, is_order_manager: true, weekend_only: false, contract_minutes: 2100, availability: [], preferences: {} },
    { id: 2, name: 'Rose', position: 'Responsable', has_keys: true, is_order_manager: true, weekend_only: false, contract_minutes: 2100, availability: [], preferences: {} },
    { id: 3, name: 'Jennyfer', position: 'Employée', has_keys: true, is_order_manager: false, weekend_only: false, contract_minutes: 1500, availability: [], preferences: {} },
    { id: 4, name: 'Noussia', position: 'Employée', has_keys: true, is_order_manager: false, weekend_only: true, contract_minutes: 900, availability: [], preferences: {} },
  ];
}
function makeCtx(employees = team(), unavByEmp = {}, start = '2026-09-07', cfg = DEFAULT_CONFIG) {
  return { config: cfg, employees, absencesByEmp: {}, unavailabilitiesByEmp: unavByEmp, weeks: buildThreeWeeks(start), weightedHistory: {} };
}
// working days per (empId, weekIndex)
function workDays(result) {
  const map = {};
  result.best.weeks.forEach((wk) => {
    for (const day of wk.days) {
      for (const s of day.shifts) {
        if (s.is_rest) continue;
        const k = s.employee_id + '|' + wk.week_index;
        map[k] = (map[k] || 0) + 1;
      }
    }
  });
  return map;
}

console.log('Repos garanti (défaut = 2 => max 5 jours/sem):');
const r = generate(makeCtx());
check('feasible', () => assert.equal(r.feasible, true));
check('chaque salarié travaille ≤ 5 jours par semaine', () => {
  const wd = workDays(r);
  for (const [k, n] of Object.entries(wd)) assert.ok(n <= 5, `${k} = ${n} jours travaillés`);
});
check('Yassine a bien ≥ 2 jours de repos chaque semaine', () => {
  const wd = workDays(r);
  for (let w = 1; w <= 3; w++) assert.ok((wd['1|' + w] || 0) <= 5, `semaine ${w}: ${wd['1|' + w]} jours`);
});

console.log('Override par salarié (Yassine 3 repos => max 4 jours):');
const emps3 = team();
emps3[0].preferences = { min_rest_days: 3 };
const r3 = generate(makeCtx(emps3));
check('feasible', () => assert.equal(r3.feasible, true));
check('Yassine ≤ 4 jours/sem', () => {
  const wd = workDays(r3);
  for (let w = 1; w <= 3; w++) assert.ok((wd['1|' + w] || 0) <= 4, `semaine ${w}: ${wd['1|' + w]} jours`);
});

console.log('Conflit repos vs couverture => impossibilité signalée:');
// Rose + Jennyfer indisponibles toute la semaine ; Noussia indispo le samedi.
// => seul Yassine peut couvrir lundi..samedi (6 jours) : incompatible avec 2 repos.
const allWeek = [1, 2, 3, 4, 5, 6, 7].map((wd) => ({ weekday: wd, all_day: true }));
const rc = generate(makeCtx(team(), {
  2: allWeek,
  3: allWeek,
  4: [{ weekday: 6, all_day: true }],
}));
check('feasible = false', () => assert.equal(rc.feasible, false));
check('raison mentionne le repos', () =>
  assert.ok(rc.reasons.join(' ').toLowerCase().includes('repos'), rc.reasons.join(' | ')));

console.log('Désactivation possible (0 repos => comportement précédent):');
const cfg0 = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
cfg0.rest.min_days_per_week = 0;
const r0 = generate(makeCtx(team(), { 2: allWeek, 3: allWeek, 4: [{ weekday: 6, all_day: true }] }, '2026-09-07', cfg0));
check('feasible sans contrainte de repos', () => assert.equal(r0.feasible, true));

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
