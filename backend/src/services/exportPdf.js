import PDFDocument from 'pdfkit';
import { frDayName, frLongDate } from '../dates.js';
import { formatDuration } from '../time.js';

// ============================================================
// Fiche de planning individuelle (PDF) — imprimable / partageable.
// Une page par salarié, au format A4. Sans dépendance native.
// ============================================================

const INK = '#211d17';
const MUTED = '#6b6357';
const LINE = '#d9d3c7';
const ACCENT = '#2c496d';

// Column layout (points) within an A4 page, 40pt margins.
const COLS = { day: 40, morning: 195, afternoon: 320, total: 455 };
const RIGHT = 555; // right edge of the table

function shiftLine(s) {
  if (!s || s.is_rest) return null;
  const parts = [];
  if (s.morning_start && s.morning_end) parts.push([s.morning_start, s.morning_end]);
  if (s.afternoon_start && s.afternoon_end) parts.push([s.afternoon_start, s.afternoon_end]);
  return parts;
}

function dayMarkers(day, shift) {
  const m = [];
  if (day.events?.holiday) return [`Fermé — ${day.events.holiday}`];
  if (shift && !shift.is_rest) {
    if (shift.is_opening) m.push('Ouverture');
    if (shift.is_closing) m.push('Fermeture');
    if (shift.is_order) m.push('Commande');
    if (shift.role === 'interim' || shift.role === 'renfort') m.push('Renfort');
  }
  if (day.events?.order) m.push('Commande (jour)');
  if (day.events?.delivery) m.push('Livraison');
  return m;
}

// Render one employee's schedule onto the current page of `doc`.
function renderEmployee(doc, schedule, emp, config) {
  const left = 40;
  // ---- header ----
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(16)
    .text(config.store?.name || 'CEDIF Saint-Antoine', left, 40);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(config.store?.address || '', left, 60);

  doc.moveTo(left, 78).lineTo(RIGHT, 78).strokeColor(LINE).lineWidth(1).stroke();

  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(15)
    .text(`${emp.name}${emp.is_temp ? ' (intérim)' : ''}`, left, 90);
  doc.fillColor(MUTED).font('Helvetica').fontSize(10)
    .text(`${emp.position || ''}${emp.contract_minutes ? '  ·  Contrat ' + formatDuration(emp.contract_minutes) + '/sem' : ''}`, left, 110);
  doc.fillColor(INK).font('Helvetica').fontSize(11)
    .text(`Planning du ${frLongDate(schedule.start_date)} au ${frLongDate(schedule.end_date)}`, left, 126);

  let y = 150;
  let grandTotal = 0;

  const rowH = 20;
  const bottom = doc.page.height - 60;

  for (const week of schedule.weeks || []) {
    // page break if not enough room for a week header + a couple rows
    if (y > bottom - 80) { doc.addPage(); y = 40; }

    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(11)
      .text(`Semaine ${week.week_index} — du ${frLongDate(week.start_date)} au ${frLongDate(week.end_date)}`, left, y);
    y += 20;

    // table header
    doc.fontSize(9).fillColor(MUTED).font('Helvetica-Bold');
    doc.text('Jour', COLS.day, y);
    doc.text('Matin', COLS.morning, y);
    doc.text('Après-midi', COLS.afternoon, y);
    doc.text('Total', COLS.total, y);
    y += 14;
    doc.moveTo(left, y).lineTo(RIGHT, y).strokeColor(LINE).lineWidth(0.7).stroke();
    y += 4;

    let weekTotal = 0;
    for (const day of week.days || []) {
      if (y > bottom) { doc.addPage(); y = 40; }
      const shift = (day.shifts || []).find((s) => s.employee_id === emp.id);
      const parts = shiftLine(shift);
      const markers = dayMarkers(day, shift);

      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
        .text(`${frDayName(day.date)} ${day.date.slice(8, 10)}/${day.date.slice(5, 7)}`, COLS.day, y, { width: COLS.morning - COLS.day - 6 });

      doc.font('Helvetica').fontSize(9.5).fillColor(INK);
      if (day.events?.holiday) {
        doc.fillColor(MUTED).text(`Fermé — ${day.events.holiday}`, COLS.morning, y, { width: RIGHT - COLS.morning });
      } else if (!parts || parts.length === 0) {
        doc.fillColor(MUTED).text('Repos', COLS.morning, y);
      } else {
        const mo = parts[0];
        // if single block in the afternoon, show it on the afternoon column
        const single = parts.length === 1;
        const isMorningOnly = single && mo && Number(mo[0].slice(0, 2)) < 14;
        if (!single) {
          doc.text(`${parts[0][0]}–${parts[0][1]}`, COLS.morning, y);
          doc.text(`${parts[1][0]}–${parts[1][1]}`, COLS.afternoon, y);
        } else if (isMorningOnly) {
          doc.text(`${mo[0]}–${mo[1]}`, COLS.morning, y);
        } else {
          doc.text(`${mo[0]}–${mo[1]}`, COLS.afternoon, y);
        }
        const worked = shift.worked_minutes || 0;
        weekTotal += worked;
        grandTotal += worked;
        doc.font('Helvetica-Bold').text(formatDuration(worked), COLS.total, y);
      }

      let yAfter = y + 13;
      if (markers.length) {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(ACCENT)
          .text(markers.join(' · '), COLS.day, yAfter, { width: RIGHT - COLS.day });
        yAfter += 12;
      }
      y = yAfter + 3;
      doc.moveTo(left, y - 2).lineTo(RIGHT, y - 2).strokeColor('#efeae0').lineWidth(0.5).stroke();
    }

    // weekly total
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ACCENT)
      .text('Total semaine', COLS.afternoon, y + 2);
    doc.text(formatDuration(weekTotal), COLS.total, y + 2);
    y += 26;
  }

  // grand total vs contract
  const weeksCount = (schedule.weeks || []).length || 1;
  const overtime = schedule.meta?.overtime_minutes || 0;
  const target = (emp.contract_minutes + overtime) * weeksCount;
  if (y > bottom - 30) { doc.addPage(); y = 40; }
  doc.moveTo(40, y).lineTo(RIGHT, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 8;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
    .text(`Total période : ${formatDuration(grandTotal)}`, 40, y);
  if (emp.contract_minutes) {
    const diff = grandTotal - target;
    const sign = diff >= 0 ? '+' : '-';
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text(`Cible ${formatDuration(target)} (${sign}${formatDuration(Math.abs(diff))})`, 40, y + 16);
  }
}

// One employee -> a single-page (or multi-page) PDF, piped to `stream`.
export function streamEmployeePdf(stream, schedule, emp, config) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(stream);
  renderEmployee(doc, schedule, emp, config);
  doc.end();
  return doc;
}

// All employees -> one PDF, one employee per page.
export function streamTeamPdf(stream, schedule, employees, config) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(stream);
  employees.forEach((emp, i) => {
    if (i > 0) doc.addPage();
    renderEmployee(doc, schedule, emp, config);
  });
  doc.end();
  return doc;
}
