// Coverage + unavailability tests (no database). Run: node test/coverage.test.mjs
import assert from 'assert';
import { DEFAULT_CONFIG } from '../src/config.js';
import { buildThreeWeeks, isoWeekday } from '../src/dates.js';
import { toMinutes } from '../src/time.js';
import { generate, availableOnDate } from '../src/engine/generator.js';
import { verifyCoverage, computeWindows, shiftIntervals } from '../src/engine/coverage.js';

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

function makeCtx(unavByEmp = {}, employees = team(), start = '2026-09-07') {
  return {
    config: DEFAULT_CONFIG,
    employees,
    absencesByEmp: {},
    unavailabilitiesByEmp: unavByEmp,
    weeks: buildThreeWeeks(start),
    weightedHistory: {},
  };
}

function dayBounds(day) {
  return { open: toMinutes(day.open_time), close: toMinutes(day.close_time) };
}

// Assert the store is never empty on any open day.
function assertFullCoverage(result) {
  for (const week of result.best.weeks) {
    for (const day of week.days) {
      const working = day.shifts.filter((s) => !s.is_rest);
      if (working.length === 0) continue; // closed day
      const { open, close } = dayBounds(day);
      const { covered, gaps } = verifyCoverage(working, open, close);
      assert.ok(covered, `Gap le ${day.date}: ${JSON.stringify(gaps)}`);
    }
  }
}

console.log('Scénario A — Magasin jamais vide (équipe par défaut):');
const rA = generate(makeCtx());
check('feasible', () => assert.equal(rA.feasible, true));
check('couverture continue chaque jour', () => assertFullCoverage(rA));
check('aucune alerte de couverture', () =>
  assert.equal(rA.best.alerts.filter((a) => a.type === 'coverage_gap').length, 0));

console.log('Scénario "pause avec couverture" :');
check('quand quelqu\'un a une pause, un autre couvre (pas de trou)', () => {
  let foundBreak = false;
  for (const week of rA.best.weeks) {
    for (const day of week.days) {
      const working = day.shifts.filter((s) => !s.is_rest);
      const withBreak = working.filter((s) => s.morning_start && s.afternoon_start);
      if (withBreak.length > 0) foundBreak = true;
      const { open, close } = dayBounds(day);
      if (working.length) assert.ok(verifyCoverage(working, open, close).covered, `trou ${day.date}`);
    }
  }
  assert.ok(foundBreak, 'aucune journée en deux parties trouvée (attendu au moins une)');
});

console.log('Scénario B — Indisponibilité toute la journée (Jennyfer mardi 15/09):');
const rB = generate(makeCtx({ 3: [{ date: '2026-09-15', all_day: true }] }));
check('feasible', () => assert.equal(rB.feasible, true));
check('Jennyfer non planifiée le 2026-09-15', () => {
  for (const week of rB.best.weeks)
    for (const day of week.days)
      if (day.date === '2026-09-15') {
        const s = day.shifts.find((x) => x.employee_id === 3 && !x.is_rest);
        assert.ok(!s, 'Jennyfer travaille alors qu\'elle est indisponible');
      }
});
check('couverture maintenue', () => assertFullCoverage(rB));

console.log('Scénario C — Indisponibilité sur plage (Rose samedi 19/09 09:50-14:00):');
const rC = generate(makeCtx({ 2: [{ date: '2026-09-19', all_day: false, start_time: '09:50', end_time: '14:00' }] }));
check('feasible', () => assert.equal(rC.feasible, true));
check('Rose ne travaille pas 09:50-14:00 le 19/09', () => {
  for (const week of rC.best.weeks)
    for (const day of week.days)
      if (day.date === '2026-09-19') {
        const s = day.shifts.find((x) => x.employee_id === 2 && !x.is_rest);
        if (s) {
          for (const [a, b] of shiftIntervals(s)) {
            assert.ok(b <= toMinutes('09:50') || a >= toMinutes('14:00'),
              `Rose planifiée pendant son indispo: ${a}-${b}`);
          }
        }
      }
});
check('couverture maintenue', () => assertFullCoverage(rC));

console.log('Scénario D — Indisponibilité récurrente (Yassine mercredi après-midi):');
const rD = generate(makeCtx({ 1: [{ weekday: 3, all_day: false, start_time: '14:00', end_time: '19:40' }] }));
check('feasible', () => assert.equal(rD.feasible, true));
check('Yassine ne travaille jamais le mercredi après 14:00', () => {
  for (const week of rD.best.weeks)
    for (const day of week.days)
      if (day.weekday === 3) {
        const s = day.shifts.find((x) => x.employee_id === 1 && !x.is_rest);
        if (s) for (const [a, b] of shiftIntervals(s)) {
          assert.ok(b <= toMinutes('14:00'), `Yassine mercredi après-midi: ${a}-${b}`);
        }
      }
});
check('couverture maintenue', () => assertFullCoverage(rD));

console.log('Scénario E — Combinaison indisponibilités + couverture:');
const rE = generate(makeCtx({
  3: [{ date: '2026-09-15', all_day: true }],
  2: [{ date: '2026-09-19', all_day: false, start_time: '09:50', end_time: '14:00' }],
  1: [{ weekday: 3, all_day: false, start_time: '14:00', end_time: '19:40' }],
}));
check('feasible', () => assert.equal(rE.feasible, true));
check('couverture maintenue partout', () => assertFullCoverage(rE));

console.log('Scénario F — Impossibilité (aucune solution valide):');
// Tous les salariés (susceptibles de travailler le samedi) indisponibles le matin
const satMorning = { all_day: false, start_time: '09:50', end_time: '13:00', date: '2026-09-12' };
const rF = generate(makeCtx({
  1: [satMorning], 2: [satMorning], 3: [satMorning], 4: [satMorning],
}));
check('feasible = false', () => assert.equal(rF.feasible, false));
check('raison mentionne la couverture', () =>
  assert.ok(rF.reasons.join(' ').toLowerCase().includes('couverture'), rF.reasons.join(' | ')));
check('aucun planning fabriqué', () => assert.equal(rF.best, null));

console.log('Vérification computeWindows:');
check('plage soustraite correctement', () => {
  const ctx = makeCtx({ 2: [{ date: '2026-09-19', all_day: false, start_time: '09:50', end_time: '14:00' }] });
  const w = computeWindows(ctx.employees[1], '2026-09-19', ctx);
  assert.deepEqual(w, [[toMinutes('14:00'), toMinutes('19:40')]]);
});
check('toute la journée => aucune fenêtre', () => {
  const ctx = makeCtx({ 3: [{ date: '2026-09-15', all_day: true }] });
  assert.equal(computeWindows(ctx.employees[2], '2026-09-15', ctx).length, 0);
});
check('Noussia indisponible en semaine (structurel)', () => {
  const ctx = makeCtx();
  assert.equal(availableOnDate(ctx.employees[3], '2026-09-07', ctx), false); // lundi
  assert.equal(availableOnDate(ctx.employees[3], '2026-09-12', ctx), true); // samedi
});

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
