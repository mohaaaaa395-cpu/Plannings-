import ExcelJS from 'exceljs';
import { toMinutes } from '../time.js';
import { isoWeekday, frLongDate } from '../dates.js';

// ============================================================
// Export a schedule to Excel using the CEDIF template layout:
//   - one sheet, three week-blocks stacked vertically
//   - days (Lundi..Dimanche) as rows, each employee as a 7-column block
//     [Matin début, Matin fin, (durée), Après-midi début, fin, (durée), Total]
//   - a "Livr" column, a weekly-total row, the config-bounds row and the
//     validation-rules legend — matching the store's real spreadsheet, with
//     live formulas that flag rule violations exactly like the original.
// ============================================================

const FR_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const frac = (hhmm) => (hhmm ? toMinutes(hhmm) / 1440 : null);

const HHMM = 'hh:mm';
const DUR = '[h]:mm';

export function buildScheduleWorkbook(schedule, employees, config) {
  const wb = new ExcelJS.Workbook();
  wb.creator = config.store?.name || 'CEDIF Saint-Antoine';
  const ws = wb.addWorksheet('Planning', {
    views: [{ showGridLines: false }],
    properties: { defaultColWidth: 7 },
  });

  const emps = employees;
  const GROUP_STRIDE = 8; // 7 used columns + 1 spacer
  const groupBase = (i) => 3 + i * GROUP_STRIDE;

  // ---- column widths ----
  ws.getColumn(1).width = 12; // day
  ws.getColumn(2).width = 5; // Livr
  emps.forEach((e, i) => {
    const b = groupBase(i);
    ws.getColumn(b).width = 7; ws.getColumn(b + 1).width = 7;
    ws.getColumn(b + 2).hidden = true; // morning duration helper
    ws.getColumn(b + 3).width = 7; ws.getColumn(b + 4).width = 7;
    ws.getColumn(b + 5).hidden = true; // afternoon duration helper
    ws.getColumn(b + 6).width = 8; // total
    ws.getColumn(b + 7).width = 2; // spacer
  });

  const bold = { bold: true };
  const center = { horizontal: 'center', vertical: 'middle' };

  // ---- header (rows 1-4) ----
  ws.getCell('A1').value = 'MAGASIN :';
  ws.getCell('A1').font = bold;
  ws.getCell('B1').value = config.store?.name || 'CEDIF Saint-Antoine';
  ws.getCell('B1').font = bold;

  // config bounds row (A2..I2) — feed the validation formulas
  const bounds = [
    ['A2', 20 / 1440, HHMM], ['B2', 60 / 1440, HHMM], ['C2', 210 / 1440, HHMM],
    ['D2', 340 / 1440, HHMM], ['E2', 360 / 1440, HHMM], ['F2', 600 / 1440, HHMM],
    ['G2', 24 / 24, DUR], ['H2', (34 * 60 + 55) / 1440, DUR], ['I2', 35 / 24, DUR],
  ];
  for (const [ref, v, fmt] of bounds) { ws.getCell(ref).value = v; ws.getCell(ref).numFmt = fmt; }

  ws.getCell('A3').value = 'Date de mise en place :';
  ws.getCell('A3').font = bold;
  ws.getCell('D3').value = new Date(schedule.created_at || Date.now());
  ws.getCell('D3').numFmt = 'dd/mm/yyyy';

  ws.getCell('A4').value = 'La saisie doit se faire au format 01:00, 15h -> 15:00, et 9h15 -> 9:15';
  ws.getCell('A4').font = { italic: true, size: 10 };

  // ---- week blocks ----
  let row = 6;
  for (const week of schedule.weeks) {
    const nameRow = row;
    const subRow = row + 1;
    const firstDay = row + 2;
    const lastDay = firstDay + 6;
    const totalRow = lastDay + 1;

    const rangeTxt = `du ${frLongDate(week.start_date)} au ${frLongDate(week.end_date)}`;

    // name header per employee (merged across the 7-col block)
    emps.forEach((e, i) => {
      const b = groupBase(i);
      ws.mergeCells(nameRow, b, nameRow, b + 6);
      const c = ws.getCell(nameRow, b);
      c.value = `${e.name} ${rangeTxt}`;
      c.font = bold; c.alignment = center;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFF7' } };
    });

    // sub-header (Livr / Matin Matin / Après midi Après midi / Total)
    ws.getCell(subRow, 2).value = 'Livr';
    ws.getCell(subRow, 2).font = bold;
    emps.forEach((e, i) => {
      const b = groupBase(i);
      const heads = [[b, 'Matin'], [b + 1, 'Matin'], [b + 3, 'Après midi'], [b + 4, 'Après midi'], [b + 6, 'Total']];
      for (const [col, txt] of heads) {
        const c = ws.getCell(subRow, col);
        c.value = txt; c.font = { bold: true, size: 10 }; c.alignment = center;
      }
    });

    // day rows
    week.days.forEach((day, di) => {
      const r = firstDay + di;
      const wd = day.weekday;
      ws.getCell(r, 1).value = FR_DAYS[wd - 1];
      ws.getCell(r, 1).font = bold;
      if (day.events && day.events.delivery) ws.getCell(r, 2).value = 'x';

      // Order-of-the-week marker (e.g. Tuesday before 12:00 by Yassine or Rose)
      const orderShift = (day.shifts || []).find((x) => x.is_order && !x.is_rest);
      const orderEmpId = orderShift ? orderShift.employee_id : (day.events && day.events.order_employee_id) || null;
      const isOrderDay = !!(day.events && day.events.order);
      if (isOrderDay) {
        const oname = (emps.find((e) => e.id === orderEmpId) || {}).name;
        const dl = (day.events && day.events.order_deadline) || (config.order && config.order.deadline) || '12:00';
        const c1 = ws.getCell(r, 1);
        c1.value = `${FR_DAYS[wd - 1]}\n📦 Commande ${dl}${oname ? ' : ' + oname : ''}`;
        c1.alignment = { wrapText: true, vertical: 'top' };
        c1.font = { bold: true, size: 10 };
        ws.getRow(r).height = 30;
      }

      emps.forEach((e, i) => {
        const b = groupBase(i);
        const LC = colLetter(b), LD = colLetter(b + 1), LE = colLetter(b + 2);
        const LF = colLetter(b + 3), LG = colLetter(b + 4), LH = colLetter(b + 5), LI = colLetter(b + 6);
        const s = (day.shifts || []).find((x) => x.employee_id === e.id && !x.is_rest);
        if (s) {
          if (s.morning_start) { ws.getCell(r, b).value = frac(s.morning_start); ws.getCell(r, b).numFmt = HHMM; }
          if (s.morning_end) { ws.getCell(r, b + 1).value = frac(s.morning_end); ws.getCell(r, b + 1).numFmt = HHMM; }
          if (s.afternoon_start) { ws.getCell(r, b + 3).value = frac(s.afternoon_start); ws.getCell(r, b + 3).numFmt = HHMM; }
          if (s.afternoon_end) { ws.getCell(r, b + 4).value = frac(s.afternoon_end); ws.getCell(r, b + 4).numFmt = HHMM; }
        }
        // highlight the morning cells of whoever handles the order that day
        if (isOrderDay && e.id === orderEmpId) {
          for (const col of [b, b + 1]) {
            ws.getCell(r, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE9C8' } };
          }
        }
        // duration helpers
        ws.getCell(r, b + 2).value = { formula: `IF(${LC}${r}="","",${LD}${r}-${LC}${r})` };
        ws.getCell(r, b + 2).numFmt = HHMM;
        ws.getCell(r, b + 5).value = { formula: `IF(${LF}${r}="","",${LG}${r}-${LF}${r})` };
        ws.getCell(r, b + 5).numFmt = HHMM;
        // total with the store's validation rules
        ws.getCell(r, b + 6).value = {
          formula:
            `IF(${LH}${r}="",IF(${LE}${r}="","",IF(${LE}${r}<$C$2,"# Matin 1",IF(${LE}${r}>$D$2,"# Matin 2",${LE}${r}))),` +
            `IF(${LE}${r}="",IF(${LH}${r}<$C$2,"# AprèsMidi 1",IF(${LH}${r}>$D$2,"# AprèsMidi 2",${LH}${r})),` +
            `IF(${LH}${r}>$D$2,"# AprèsMidi 2",IF(${LE}${r}>$D$2,"# Matin 2",` +
            `IF((${LF}${r}-${LD}${r})>$B$2,"# Repas 1",IF((${LF}${r}-${LD}${r})<$A$2,"# Repas 2",` +
            `IF((${LE}${r}+${LH}${r})<$E$2,"# Jour 1",IF((${LE}${r}+${LH}${r})>$F$2,"# Jour 2",${LE}${r}+${LH}${r}))))))))`,
        };
        ws.getCell(r, b + 6).numFmt = HHMM;
      });
    });

    // weekly total row
    ws.getCell(totalRow, 1).value = 'Durée hebdomadaire :';
    ws.getCell(totalRow, 1).font = bold;
    emps.forEach((e, i) => {
      const b = groupBase(i);
      const LI = colLetter(b + 6);
      const c = ws.getCell(totalRow, b + 6);
      c.value = { formula: `SUM(${LI}${firstDay}:${LI}${lastDay})` };
      c.numFmt = DUR; c.font = bold;
    });

    row = totalRow + 3; // gap before next week
  }

  // ---- rules legend ----
  const legend = [
    'Erreurs # :',
    '# Matin 1 : la matinée seule doit être supérieure à 3h30',
    '# Matin 2 : la matinée doit être inférieure à 5h40',
    "# AprèsMidi 1 : l'après-midi seule doit être supérieure à 3h30",
    "# AprèsMidi 2 : l'après-midi doit être inférieure à 5h40",
    '# Repas 1 : la pause repas ne doit pas être supérieure à 1h',
    '# Repas 2 : la pause repas ne doit pas être inférieure à 20min',
    '# Jour 1 : la journée (matin + après-midi) doit être supérieure à 6h',
    '# Jour 2 : la journée ne doit pas dépasser 10h',
    '# Semaine 1 : la durée hebdo du temps partiel est incorrecte (24h < H < 34h55)',
    '# Semaine 2 : la semaine à temps plein doit faire 35h00',
  ];
  legend.forEach((txt, i) => {
    const c = ws.getCell(row + i, 1);
    c.value = txt;
    c.font = i === 0 ? bold : { size: 10, color: { argb: 'FF7A7A7A' } };
  });

  return wb;
}
