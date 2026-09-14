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

console.log('Scénario I — Bornes horaires par salarié (ne peut pas fermer):');
check('computeWindows borne la fenêtre à latest_end', () => {
  const emps = team();
  emps[1].latest_end = '18:40'; // Rose part au plus tard à 18:40
  const ctx = makeCtx({}, emps);
  const w = computeWindows(emps[1], '2026-09-12', ctx); // samedi
  assert.equal(w.length, 1);
  assert.equal(w[0][1], toMinutes('18:40'), 'la fenêtre doit s\'arrêter à 18:40');
});
check('computeWindows borne la fenêtre à earliest_start', () => {
  const emps = team();
  emps[2].earliest_start = '11:00'; // Jennyfer arrive au plus tôt à 11:00
  const ctx = makeCtx({}, emps);
  const w = computeWindows(emps[2], '2026-09-08', ctx); // mardi
  assert.equal(w[0][0], toMinutes('11:00'), 'la fenêtre doit commencer à 11:00');
});
check('un salarié qui part à 18:40 ne ferme jamais (weekend)', () => {
  const emps = team();
  emps[3].latest_end = '18:40'; // Noussia (weekend) part au plus tard 18:40
  const r = generate(makeCtx({}, emps));
  assert.equal(r.feasible, true);
  assertFullCoverage(r);
  for (const w of r.best.weeks)
    for (const d of w.days)
      for (const s of d.shifts) {
        if (s.is_rest || s.employee_id !== 4) continue;
        assert.ok(!s.is_closing, `Noussia ferme le ${d.date} alors qu'elle part à 18:40`);
        if (s.afternoon_end) assert.ok(toMinutes(s.afternoon_end) <= toMinutes('18:40'),
          `Noussia finit après 18:40 le ${d.date}`);
      }
});

console.log('Scénario J — Préférence « pas le dimanche » + effectif livraison:');
const teamJ = team();
teamJ[2].preferences = { avoidSunday: true }; // Jennyfer
const rJ = generate(makeCtx({}, teamJ));
check('feasible', () => assert.equal(rJ.feasible, true));
check('Jennyfer n\'est jamais planifiée le dimanche', () => {
  for (const w of rJ.best.weeks)
    for (const d of w.days) {
      if (isoWeekday(d.date) !== 7) continue;
      const s = d.shifts.find((x) => x.employee_id === 3 && !x.is_rest);
      assert.ok(!s, `Jennyfer travaille le dimanche ${d.date}`);
    }
});
check('jours de livraison : pic de 3 présents en même temps, renfort court', () => {
  const reinforceMax = (DEFAULT_CONFIG.deliveries.reinforce_minutes || 180) + (DEFAULT_CONFIG.shifts.round_minutes || 0);
  const peak = (day) => {
    const ivs = day.shifts.filter((s) => !s.is_rest).flatMap(shiftIntervals);
    let mx = 0;
    for (let t = toMinutes('09:50'); t < toMinutes('19:40'); t += 5) {
      let c = 0; for (const [a, b] of ivs) if (a <= t && t < b) c++;
      mx = Math.max(mx, c);
    }
    return mx;
  };
  for (const w of rJ.best.weeks)
    for (const d of w.days) {
      if (![4, 5].includes(isoWeekday(d.date))) continue;
      const present = d.shifts.filter((x) => !x.is_rest);
      // Quand 3 personnes sont présentes, elles se recoupent (pic simultané = 3).
      if (present.length >= 3) assert.ok(peak(d) >= 3, `pas de pic de 3 le ${d.date}`);
      // Un renfort livraison est un coup de main court, pas une journée entière.
      for (const s of present) {
        if (s.role !== 'renfort') continue;
        assert.ok((s.worked_minutes || 0) <= reinforceMax, `renfort trop long le ${d.date}: ${s.worked_minutes} min`);
      }
    }
});
check('les heures contractuelles restent respectées (± tolérance)', () => {
  const tol = DEFAULT_CONFIG.generator.hours_tolerance_minutes;
  const perWeek = {};
  rJ.best.weeks.forEach((w, i) => {
    for (const d of w.days)
      for (const s of d.shifts)
        if (!s.is_rest) perWeek[`${s.employee_id}:${i}`] = (perWeek[`${s.employee_id}:${i}`] || 0) + s.worked_minutes;
  });
  for (const emp of teamJ) {
    if (emp.weekend_only) continue; // Noussia : contrainte week-end, écart connu
    rJ.best.weeks.forEach((w, i) => {
      const got = perWeek[`${emp.id}:${i}`] || 0;
      assert.ok(got <= emp.contract_minutes + tol, `${emp.name} sem${i + 1} : ${(got / 60).toFixed(1)}h > ${(emp.contract_minutes / 60)}h + tol`);
    });
  }
});

console.log('Scénario L — Renfort intérimaire auto les jours de livraison:');
check('un intérimaire complète l\'équipe de livraison quand il manque un permanent', () => {
  const teamL = [
    ...team(),
    { id: 5, name: 'Intérim', position: 'Intérimaire', has_keys: false, is_order_manager: false, weekend_only: false, is_temp: true, contract_minutes: 0, availability: [], preferences: {} },
  ];
  const ctx = makeCtx({}, teamL); // start 2026-09-07
  ctx.absencesByEmp = { 3: [{ start_date: '2026-09-07', end_date: '2026-09-13' }] }; // Jennyfer absente S1
  const r = generate(ctx);
  assert.equal(r.feasible, true);
  const reinforceMax = (DEFAULT_CONFIG.deliveries.reinforce_minutes || 180) + (DEFAULT_CONFIG.shifts.round_minutes || 0);
  let used = false;
  for (const d of r.best.weeks[0].days) {
    if (![4, 5].includes(isoWeekday(d.date))) continue;
    const it = d.shifts.find((s) => s.employee_id === 5 && !s.is_rest);
    if (!it) continue;
    used = true;
    assert.ok(!it.is_opening && !it.is_closing, `intérim ouvre/ferme le ${d.date}`);
    assert.ok((it.worked_minutes || 0) <= reinforceMax, `renfort intérim trop long le ${d.date}`);
    // jamais seul au-delà d'une pause
    const permIv = mergeIntervals(d.shifts.filter((s) => !s.is_rest && s.employee_id !== 5).flatMap(shiftIntervals));
    for (const [a, b] of shiftIntervals(it).flatMap(([a, b]) => findGaps(permIv, a, b)))
      assert.ok(b - a <= (DEFAULT_CONFIG.shifts.break_minutes + (DEFAULT_CONFIG.shifts.round_minutes || 0)), `intérim seul trop longtemps le ${d.date}`);
  }
  assert.ok(used, 'l\'intérimaire n\'a jamais été appelé en renfort livraison');
});

console.log('Scénario N — Le score ne s\'effondre pas (sous-effectif voulu / congé):');
check('score correct sur 3 semaines en auto', () => {
  const ctx = makeCtx({}, team(), '2026-09-21');
  const r = generate(ctx);
  assert.ok(r.best.score >= 60, `score auto trop bas: ${r.best.score}`);
});
check('effectif volontairement léger ne met pas le score à zéro', () => {
  const ctx = makeCtx({}, team(), '2026-09-21');
  ctx.config = { ...DEFAULT_CONFIG, staffing: { by_weekday: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 }, overrides: [] } };
  const r = generate(ctx);
  assert.ok(r.best.score >= 25, `score sous-effectif trop bas: ${r.best.score}`);
});
check('un salarié en congé une semaine ne plombe pas le score', () => {
  const ctx = makeCtx({}, team(), '2026-09-21');
  ctx.absencesByEmp = { 3: [{ start_date: '2026-09-21', end_date: '2026-09-27' }] };
  const r = generate(ctx);
  assert.ok(r.best.score >= 40, `score avec congé trop bas: ${r.best.score}`);
});

console.log('Scénario M — Effectif voulu par jour (plafond + plancher):');
check('le nombre de personnes par jour est respecté', () => {
  const ctx = makeCtx({}, team(), '2026-09-21');
  ctx.config = { ...DEFAULT_CONFIG, staffing: { by_weekday: { 1: 1, 3: 1, 6: 3 }, overrides: [{ date: '2026-09-22', target: 1 }] } };
  const r = generate(ctx);
  assert.equal(r.feasible, true);
  for (const w of r.best.weeks)
    for (const d of w.days) {
      const wd = isoWeekday(d.date);
      const n = d.shifts.filter((s) => !s.is_rest).length;
      const target = d.date === '2026-09-22' ? 1 : ({ 1: 1, 3: 1, 6: 3 })[wd];
      if (target == null) continue;
      assert.ok(n <= target, `${d.date} : ${n} présents > cible ${target}`);
      assert.ok(n >= 1, `${d.date} : magasin vide`);
      if (target === 1) assert.equal(n, 1, `${d.date} : cible 1 non respectée (${n})`);
    }
});

console.log('Scénario K — Jours consécutifs entre deux plannings:');
check('un salarié ayant fait 5 jours avant le lundi ne travaille pas ce lundi', () => {
  const ctx = makeCtx({}, team(), '2026-09-21');
  // Yassine a travaillé du mercredi 16 au dimanche 20 (5 jours d'affilée).
  ctx.priorWorkDates = { 1: new Set(['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']) };
  const r = generate(ctx);
  assert.equal(r.feasible, true);
  const mon = r.best.weeks[0].days.find((d) => d.date === '2026-09-21');
  const works = mon.shifts.some((s) => s.employee_id === 1 && !s.is_rest);
  assert.ok(!works, 'Yassine enchaîne un 6e jour consécutif à cheval sur deux plannings');
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
