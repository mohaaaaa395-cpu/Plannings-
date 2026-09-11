// Coverage + unavailability tests (no database). Run: node test/coverage.test.mjs
import assert from 'assert';
import { DEFAULT_CONFIG } from '../src/config.js';
import { buildThreeWeeks, isoWeekday } from '../src/dates.js';
import { toMinutes } from '../src/time.js';
import { generate, availableOnDate } from '../src/engine/generator.js';
import { verifyCoverage, computeWindows, shiftIntervals, mergeIntervals, intervalCoveredBy, findGaps, buildDayShifts } from '../src/engine/coverage.js';

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
check('horaires « carrés » (alignés sur la grille, pas de 11:07)', () => {
  const grid = DEFAULT_CONFIG.shifts.round_minutes; // 15
  const bornes = new Set([
    DEFAULT_CONFIG.store.weekday_open, DEFAULT_CONFIG.store.weekday_close,
    DEFAULT_CONFIG.store.sunday_open, DEFAULT_CONFIG.store.sunday_close,
  ].map(toMinutes));
  for (const w of rA.best.weeks)
    for (const d of w.days)
      for (const s of d.shifts) {
        if (s.is_rest) continue;
        for (const t of [s.morning_start, s.morning_end, s.afternoon_start, s.afternoon_end]) {
          if (!t) continue;
          const m = toMinutes(t);
          // Chaque horaire est soit sur la grille, soit calé sur une borne
          // magasin (ou décalé d'un multiple de la grille depuis une borne).
          const alignedGrid = m % grid === 0;
          const alignedBound = [...bornes].some((b) => (m - b) % grid === 0);
          assert.ok(alignedGrid || alignedBound, `horaire pas carré: ${t}`);
        }
      }
});

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

console.log('Scénario G — Intérimaire seul seulement pendant la pause d\'un permanent:');
const teamWithTemp = [
  ...team(),
  { id: 5, name: 'Intérim', position: 'Intérimaire', has_keys: false, is_order_manager: false, weekend_only: false, is_temp: true, contract_minutes: 1800, availability: [], preferences: {} },
];
const rG = generate(makeCtx({}, teamWithTemp));
const MAX_SOLO = DEFAULT_CONFIG.shifts.break_minutes + (DEFAULT_CONFIG.shifts.round_minutes || 0);
check('feasible', () => assert.equal(rG.feasible, true));
check('couverture continue partout', () => assertFullCoverage(rG));
check('intérim: jamais ouverture/fermeture, seul au plus le temps d\'une pause, mais employé', () => {
  let tempShifts = 0;
  for (const w of rG.best.weeks)
    for (const d of w.days) {
      const working = d.shifts.filter((s) => !s.is_rest);
      const { open, close } = dayBounds(d);
      const permIv = mergeIntervals(working.filter((s) => s.employee_id !== 5).flatMap(shiftIntervals));
      for (const s of working) {
        if (s.employee_id !== 5) continue;
        tempShifts++;
        assert.ok(!s.is_opening && !s.is_closing, `intérim ouvre/ferme le ${d.date}`);
        // Les plages où l'intérim n'est pas couvert par un permanent (= seul)
        // doivent être bornées à une pause et hors ouverture/fermeture.
        const solo = shiftIntervals(s).flatMap(([a, b]) => findGaps(permIv, a, b));
        for (const [a, b] of solo) {
          assert.ok(b - a <= MAX_SOLO, `intérim seul trop longtemps le ${d.date}: ${JSON.stringify([a, b])}`);
          assert.ok(a > open && b < close, `intérim seul à l'ouverture/fermeture le ${d.date}`);
        }
      }
    }
  assert.ok(tempShifts > 0, 'intérimaire jamais utilisé');
});
// Cas d'un seul permanent présent avec un intérim sur une journée : le
// permanent DOIT pouvoir prendre sa pause, couverte par l'intérim (seul à ce
// moment, ce qui est autorisé). Testé directement sur le constructeur de jour.
check('un permanent seul obtient une pause couverte par l\'intérim', () => {
  const day = { date: '2026-09-08', weekday: 2, is_sunday: false,
    open_time: DEFAULT_CONFIG.store.weekday_open, close_time: DEFAULT_CONFIG.store.weekday_close };
  const full = [[toMinutes('09:50'), toMinutes('19:40')]];
  const permEmp = { id: 1, name: 'Yassine', is_temp: false };
  const tempEmp = { id: 5, name: 'Intérim', is_temp: true };
  const workers = [
    { emp: permEmp, windows: full, target: 560, isOrder: false, openScore: 0, closeScore: 0 },
    { emp: tempEmp, windows: full, target: 480, isOrder: false, openScore: 0, closeScore: 0 },
  ];
  const res = buildDayShifts(DEFAULT_CONFIG, day, workers, [], () => 0.5);
  const { open, close } = dayBounds(day);
  assert.ok(res.covered, 'magasin non couvert');
  const perm = res.shifts.find((s) => s.employee_id === 1 && !s.is_rest);
  const temp = res.shifts.find((s) => s.employee_id === 5 && !s.is_rest);
  assert.ok(perm && perm.morning_start && perm.afternoon_start, 'le permanent seul ne prend pas de pause');
  const brk = [toMinutes(perm.morning_end), toMinutes(perm.afternoon_start)];
  assert.ok(intervalCoveredBy(brk, mergeIntervals(shiftIntervals(temp))),
    'la pause du permanent n\'est pas couverte par l\'intérim');
  // Le permanent ouvre et ferme ; l'intérim jamais.
  assert.ok(perm.is_opening && perm.is_closing, 'le permanent doit ouvrir et fermer');
  assert.ok(!temp.is_opening && !temp.is_closing, 'l\'intérim ne doit ni ouvrir ni fermer');
});
// Un seul permanent, indisponible un dimanche => impossible (intérim ne tient pas seul)
const rGx = generate(makeCtx(
  { 1: [{ date: '2026-09-13', all_day: true }] },
  [
    { id: 1, name: 'Yassine', position: 'Directeur', has_keys: true, is_order_manager: true, weekend_only: false, is_temp: false, contract_minutes: 2100, availability: [], preferences: {} },
    { id: 5, name: 'Intérim', position: 'Intérimaire', has_keys: false, is_order_manager: false, weekend_only: false, is_temp: true, contract_minutes: 1800, availability: [], preferences: {} },
  ]
));
check('impossible si seul un intérimaire pourrait tenir le magasin', () => assert.equal(rGx.feasible, false));
check('raison mentionne le permanent', () =>
  assert.ok(rGx.reasons.join(' ').toLowerCase().includes('permanent'), rGx.reasons.join(' | ')));

console.log('Scénario H — Magasin fermé les jours fériés:');
const rH = generate(makeCtx({}, team(), '2026-11-09')); // couvre le 11/11 (Armistice)
check('feasible malgré un férié dans la période', () => assert.equal(rH.feasible, true));
check('personne ne travaille le 11/11 + libellé férié', () => {
  let holiday = null;
  for (const w of rH.best.weeks)
    for (const d of w.days)
      if (d.date === '2026-11-11') holiday = d;
  assert.ok(holiday, 'jour 11/11 introuvable');
  assert.equal(holiday.shifts.filter((s) => !s.is_rest).length, 0, 'personne ne doit travailler un férié');
  assert.equal(holiday.events.holiday, 'Armistice 1918');
});
check('exception « ouvert ce jour-là » rouvre le magasin', () => {
  const ctx = makeCtx({}, team(), '2026-11-09');
  ctx.config = { ...DEFAULT_CONFIG, holidays: { ...DEFAULT_CONFIG.holidays, open_on: ['2026-11-11'] } };
  const r = generate(ctx);
  let day = null;
  for (const w of r.best.weeks) for (const d of w.days) if (d.date === '2026-11-11') day = d;
  assert.ok(day.shifts.filter((s) => !s.is_rest).length > 0, 'le magasin doit rouvrir avec open_on');
});

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
